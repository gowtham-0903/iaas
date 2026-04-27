import json
import os
import time
from typing import Optional

from flask import Blueprint, current_app, jsonify, request, send_file
from flask_jwt_extended import get_jwt, get_jwt_identity, jwt_required
from marshmallow import ValidationError
from sqlalchemy.exc import IntegrityError
from werkzeug.utils import secure_filename

from openai import OpenAI

from app.extensions import db
from app.models.candidate import Candidate, CANDIDATE_STATUSES
from app.models.client import Client
from app.models.job_description import JobDescription
from app.models.user import User, UserRole
from app.services.file_parser import extract_text_from_docx, extract_text_from_pdf
from app.schemas.candidate_schema import candidate_schema, candidates_schema, candidate_update_schema


candidates_bp = Blueprint("candidates", __name__, url_prefix="/api/candidates")

ALLOWED_ROLES = {
    UserRole.RECRUITER.value,
    UserRole.SR_RECRUITER.value,
    UserRole.M_RECRUITER.value,
    UserRole.QC.value,
    UserRole.ADMIN.value,
}

RESUME_ALLOWED_ROLES = {
    UserRole.RECRUITER.value,
    UserRole.SR_RECRUITER.value,
    UserRole.M_RECRUITER.value,
    UserRole.ADMIN.value,
}

RESUME_UPLOAD_SUBDIR = os.path.join("uploads", "resumes")
RESUME_MAX_UPLOAD_BYTES = 2 * 1024 * 1024
RESUME_ALLOWED_EXTENSIONS = {".pdf", ".docx"}
RESUME_EXTRACT_SYSTEM_PROMPT = (
    "Extract candidate details from this resume. Return ONLY \n"
    "valid JSON with keys: full_name, email, phone. If a field \n"
    "cannot be found return null for that field."
)


def _get_current_user() -> Optional[User]:
    user_id = get_jwt_identity()
    if user_id is None:
        return None
    return User.query.get(int(user_id))


def _can_access_client(role: str, user: Optional[User], client_id: int) -> bool:
    if role in {UserRole.ADMIN.value, UserRole.M_RECRUITER.value, UserRole.SR_RECRUITER.value, UserRole.QC.value}:
        return True

    return role == UserRole.RECRUITER.value and user is not None and user.client_id == client_id


def _get_resume_upload_paths(candidate_id: int, original_filename: str):
    safe_name = secure_filename(original_filename)
    timestamp = int(time.time())
    final_filename = f"{candidate_id}_{timestamp}_{safe_name}"
    relative_path = os.path.join(RESUME_UPLOAD_SUBDIR, final_filename)
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    absolute_path = os.path.join(project_root, relative_path)
    return safe_name, relative_path, absolute_path


def _resolve_upload_absolute_path(relative_path):
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    uploads_root = os.path.abspath(os.path.join(project_root, "uploads"))
    candidate_path = os.path.abspath(os.path.join(project_root, relative_path))

    # Prevent path traversal outside uploads root.
    if not candidate_path.startswith(uploads_root + os.sep):
        return None

    return candidate_path


def _extract_resume_fields_with_ai(resume_text: str):
    api_key = current_app.config.get("OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")

    client = OpenAI(api_key=api_key)
    delays = [1, 2, 4]

    for attempt, delay in enumerate(delays, start=1):
        try:
            completion = client.chat.completions.create(
                model="gpt-4o",
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": RESUME_EXTRACT_SYSTEM_PROMPT},
                    {"role": "user", "content": resume_text},
                ],
            )
            content = completion.choices[0].message.content or "{}"
            parsed = json.loads(content)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass

        if attempt < len(delays):
            time.sleep(delay)

    raise RuntimeError("Resume AI extraction failed after 3 attempts")


@candidates_bp.get("")
@jwt_required()
def list_candidates():
    role = get_jwt().get("role")
    if role not in ALLOWED_ROLES:
        return jsonify({"message": "Forbidden"}), 403

    user = _get_current_user()
    if user is None:
        return jsonify({"message": "User not found"}), 404

    query = Candidate.query

    client_id = request.args.get("client_id", type=int)
    jd_id = request.args.get("jd_id", type=int)
    status = request.args.get("status", type=str)

    if role == UserRole.RECRUITER.value:
        if user.client_id is None:
            return jsonify({"candidates": []}), 200
        query = query.filter(Candidate.client_id == user.client_id)

    if client_id is not None:
        if not _can_access_client(role, user, client_id):
            return jsonify({"message": "Forbidden"}), 403
        query = query.filter(Candidate.client_id == client_id)

    if jd_id is not None:
        query = query.filter(Candidate.jd_id == jd_id)

    if status:
        normalized_status = status.strip().upper()
        if normalized_status not in CANDIDATE_STATUSES:
            return jsonify({"errors": {"status": [f"Must be one of: {', '.join(CANDIDATE_STATUSES)}"]}}), 400
        query = query.filter(Candidate.status == normalized_status)

    candidates = query.order_by(Candidate.created_at.desc()).all()
    return jsonify({"candidates": candidates_schema.dump(candidates)}), 200


@candidates_bp.post("")
@jwt_required()
def create_candidate():
    role = get_jwt().get("role")
    if role not in ALLOWED_ROLES:
        return jsonify({"message": "Forbidden"}), 403

    user = _get_current_user()
    if user is None:
        return jsonify({"message": "User not found"}), 404

    payload = request.get_json(silent=True) or {}
    try:
        validated = candidate_schema.load(payload)
    except ValidationError as err:
        return jsonify({"errors": err.messages}), 400

    client_id = validated["client_id"]
    jd_id = validated["jd_id"]

    if not _can_access_client(role, user, client_id):
        return jsonify({"message": "Forbidden"}), 403

    client = Client.query.get(client_id)
    if client is None:
        return jsonify({"error": "Client not found"}), 404

    jd = JobDescription.query.get(jd_id)
    if jd is None:
        return jsonify({"error": "JD not found"}), 404

    if jd.client_id != client_id:
        return jsonify({"errors": {"jd_id": ["JD does not belong to this client."]}}), 400

    candidate = Candidate(
        client_id=client_id,
        jd_id=jd_id,
        full_name=validated["full_name"].strip(),
        email=validated["email"].strip().lower(),
        status=validated.get("status", "APPLIED"),
    )
    db.session.add(candidate)

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "Candidate already exists for this JD"}), 409

    return jsonify({"candidate": candidate_schema.dump(candidate)}), 201


@candidates_bp.put("/<int:candidate_id>")
@jwt_required()
def update_candidate(candidate_id):
    role = get_jwt().get("role")
    if role not in ALLOWED_ROLES:
        return jsonify({"message": "Forbidden"}), 403

    user = _get_current_user()
    if user is None:
        return jsonify({"message": "User not found"}), 404

    candidate = Candidate.query.get(candidate_id)
    if candidate is None:
        return jsonify({"error": "Candidate not found"}), 404

    if not _can_access_client(role, user, candidate.client_id):
        return jsonify({"message": "Forbidden"}), 403

    payload = request.get_json(silent=True) or {}
    try:
        validated = candidate_update_schema.load(payload)
    except ValidationError as err:
        return jsonify({"errors": err.messages}), 400

    if "jd_id" in validated:
        jd = JobDescription.query.get(validated["jd_id"])
        if jd is None:
            return jsonify({"error": "JD not found"}), 404
        if jd.client_id != candidate.client_id:
            return jsonify({"errors": {"jd_id": ["JD does not belong to candidate client."]}}), 400
        candidate.jd_id = jd.id

    if "full_name" in validated:
        candidate.full_name = validated["full_name"].strip()

    if "email" in validated:
        candidate.email = validated["email"].strip().lower()

    if "phone" in validated:
        phone = validated["phone"]
        candidate.phone = phone.strip() if isinstance(phone, str) and phone.strip() else None

    if "status" in validated:
        candidate.status = validated["status"]

    db.session.commit()
    return jsonify({"candidate": candidate_schema.dump(candidate)}), 200


@candidates_bp.delete("/<int:candidate_id>")
@jwt_required()
def delete_candidate(candidate_id):
    role = get_jwt().get("role")
    if role not in {UserRole.ADMIN.value, UserRole.M_RECRUITER.value, UserRole.SR_RECRUITER.value}:
        return jsonify({"message": "Forbidden"}), 403

    user = _get_current_user()
    if user is None:
        return jsonify({"message": "User not found"}), 404

    candidate = Candidate.query.get(candidate_id)
    if candidate is None:
        return jsonify({"error": "Candidate not found"}), 404

    db.session.delete(candidate)
    db.session.commit()
    return jsonify({"message": "Candidate deleted successfully"}), 200


@candidates_bp.post("/<int:candidate_id>/resume")
@jwt_required()
def upload_candidate_resume(candidate_id):
    role = get_jwt().get("role")
    if role not in RESUME_ALLOWED_ROLES:
        return jsonify({"message": "Forbidden"}), 403

    user = _get_current_user()
    if user is None:
        return jsonify({"message": "User not found"}), 404

    candidate = Candidate.query.get(candidate_id)
    if candidate is None:
        return jsonify({"error": "Candidate not found"}), 404

    if not _can_access_client(role, user, candidate.client_id):
        return jsonify({"message": "Forbidden"}), 403

    upload = request.files.get("resume")
    if upload is None or not upload.filename:
        return jsonify({"errors": {"resume": ["Resume file is required"]}}), 400

    original_filename = upload.filename
    ext = os.path.splitext(original_filename)[1].lower()
    if ext not in RESUME_ALLOWED_EXTENSIONS:
        return jsonify({"errors": {"resume": ["Only .pdf and .docx are supported"]}}), 400

    file_bytes = upload.read()
    if len(file_bytes) > RESUME_MAX_UPLOAD_BYTES:
        return jsonify({"errors": {"resume": ["File size must be 2MB or less"]}}), 400

    safe_name, relative_path, absolute_path = _get_resume_upload_paths(candidate_id, original_filename)
    if not safe_name:
        return jsonify({"errors": {"resume": ["Invalid filename"]}}), 400

    os.makedirs(os.path.dirname(absolute_path), exist_ok=True)
    with open(absolute_path, "wb") as output_file:
        output_file.write(file_bytes)

    candidate.resume_url = relative_path
    candidate.resume_filename = safe_name
    db.session.commit()

    return jsonify({"candidate": candidate_schema.dump(candidate)}), 200


@candidates_bp.post("/<int:candidate_id>/extract-resume")
@jwt_required()
def extract_candidate_resume(candidate_id):
    role = get_jwt().get("role")
    if role not in RESUME_ALLOWED_ROLES:
        return jsonify({"message": "Forbidden"}), 403

    user = _get_current_user()
    if user is None:
        return jsonify({"message": "User not found"}), 404

    candidate = Candidate.query.get(candidate_id)
    if candidate is None:
        return jsonify({"error": "Candidate not found"}), 404

    if not _can_access_client(role, user, candidate.client_id):
        return jsonify({"message": "Forbidden"}), 403

    if not candidate.resume_url:
        return jsonify({"error": "No resume uploaded for this candidate"}), 404

    absolute_path = _resolve_upload_absolute_path(candidate.resume_url)
    if absolute_path is None or not os.path.exists(absolute_path):
        return jsonify({"error": "Uploaded resume not found"}), 404

    ext = os.path.splitext(candidate.resume_url)[1].lower()
    with open(absolute_path, "rb") as resume_file:
        file_bytes = resume_file.read()

    if ext == ".pdf":
        extracted_text = extract_text_from_pdf(file_bytes)
    elif ext == ".docx":
        extracted_text = extract_text_from_docx(file_bytes)
    else:
        return jsonify({"error": "Unsupported resume format"}), 400

    if not extracted_text:
        return jsonify({"error": "Unable to extract text from resume"}), 400

    try:
        extracted = _extract_resume_fields_with_ai(extracted_text)
    except RuntimeError as err:
        return jsonify({"error": str(err)}), 503

    extracted_full_name = extracted.get("full_name")
    extracted_email = extracted.get("email")
    extracted_phone = extracted.get("phone")

    extracted_full_name = extracted_full_name.strip() if isinstance(extracted_full_name, str) else None
    extracted_email = extracted_email.strip().lower() if isinstance(extracted_email, str) else None
    extracted_phone = extracted_phone.strip() if isinstance(extracted_phone, str) else None

    if extracted_full_name:
        candidate.full_name = extracted_full_name
    if extracted_email:
        candidate.email = extracted_email
    candidate.phone = extracted_phone if extracted_phone else None
    candidate.ai_extracted = True

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "Extracted email conflicts with an existing candidate for this JD"}), 409

    return (
        jsonify(
            {
                "extracted": {
                    "full_name": extracted_full_name,
                    "email": extracted_email,
                    "phone": extracted_phone,
                },
                "candidate": candidate_schema.dump(candidate),
            }
        ),
        200,
    )


@candidates_bp.get("/<int:candidate_id>/resume")
@jwt_required()
def download_candidate_resume(candidate_id):
    role = get_jwt().get("role")
    if role not in RESUME_ALLOWED_ROLES:
        return jsonify({"message": "Forbidden"}), 403

    user = _get_current_user()
    if user is None:
        return jsonify({"message": "User not found"}), 404

    candidate = Candidate.query.get(candidate_id)
    if candidate is None:
        return jsonify({"error": "Candidate not found"}), 404

    if not _can_access_client(role, user, candidate.client_id):
        return jsonify({"message": "Forbidden"}), 403

    if not candidate.resume_url:
        return jsonify({"error": "No resume uploaded for this candidate"}), 404

    absolute_path = _resolve_upload_absolute_path(candidate.resume_url)
    if absolute_path is None or not os.path.exists(absolute_path):
        return jsonify({"error": "Uploaded resume not found"}), 404

    download_name = candidate.resume_filename or os.path.basename(candidate.resume_url)
    return send_file(absolute_path, as_attachment=True, download_name=download_name)
