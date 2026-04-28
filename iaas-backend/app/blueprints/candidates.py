import json
import os
import time
from datetime import datetime, timedelta, timezone
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
from app.models.jd_recruiter_assignment import JDRecruiterAssignment
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
    "valid JSON with keys: full_name, email, phone, skills (array of skill name strings). \n"
    "If a field cannot be found return null for that field."
)


def _get_current_user() -> Optional[User]:
    user_id = get_jwt_identity()
    if user_id is None:
        return None
    return User.query.get(int(user_id))


def _can_access_client(role: str, user: Optional[User], client_id: int) -> bool:
    if role == UserRole.ADMIN.value:
        return True

    if role == UserRole.QC.value:
        return True

    # RECRUITER, SR_RECRUITER, M_RECRUITER: can only access their own client
    if role in {UserRole.RECRUITER.value, UserRole.SR_RECRUITER.value, UserRole.M_RECRUITER.value}:
        return user is not None and user.client_id == client_id

    return False


def _is_jd_assigned_to_recruiter(jd_id: int, recruiter_id: int) -> bool:
    """Check if a JD is assigned to a recruiter via JDRecruiterAssignment."""
    assignment = JDRecruiterAssignment.query.filter_by(
        jd_id=jd_id, recruiter_id=recruiter_id
    ).first()
    return assignment is not None


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


def _check_cooling_period(email: str, jd_id: int):
    """
    Check if a candidate is in cooling period after NOT_SELECTED status.
    
    Returns:
        (is_blocked: bool, unblock_date: str or None)
        Blocked if a NOT_SELECTED candidate with this email+jd_id 
        exists with status_updated_at within the last 30 days.
    """
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=30)
    
    candidate = Candidate.query.filter(
        db.func.lower(Candidate.email) == email.lower().strip(),
        Candidate.jd_id == jd_id,
        Candidate.status == 'NOT_SELECTED',
        Candidate.status_updated_at >= cutoff,
    ).first()
    
    if candidate is None:
        return False, None
    
    unblock_date = (
        candidate.status_updated_at + timedelta(days=30)
    ).strftime('%Y-%m-%d')
    return True, unblock_date


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

    # RECRUITER, SR_RECRUITER, M_RECRUITER: only see candidates from their client
    if role in {UserRole.RECRUITER.value, UserRole.SR_RECRUITER.value, UserRole.M_RECRUITER.value}:
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
    email = validated["email"]

    # For non-ADMIN roles, enforce client_id match
    if role != UserRole.ADMIN.value:
        if user.client_id != client_id:
            return jsonify({"message": "Forbidden"}), 403

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

    # For RECRUITER role, check JD assignment
    if role == UserRole.RECRUITER.value:
        if not _is_jd_assigned_to_recruiter(jd_id, user.id):
            return jsonify({"message": "JD not assigned to this recruiter"}), 403

    # Check cooling period for recruiter roles
    if role in {UserRole.RECRUITER.value, UserRole.SR_RECRUITER.value, UserRole.M_RECRUITER.value, UserRole.ADMIN.value}:
        is_blocked, unblock_date = _check_cooling_period(email, jd_id)
        if is_blocked:
            return jsonify({"error": f"Candidate was not selected for this JD. Re-apply allowed after {unblock_date}."}), 409

    candidate = Candidate(
        client_id=client_id,
        jd_id=jd_id,
        full_name=validated["full_name"].strip(),
        email=email.strip().lower(),
        status=validated.get("status", "APPLIED"),
    )
    db.session.add(candidate)

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "Candidate already exists for this JD"}), 409

    return jsonify({"candidate": candidate_schema.dump(candidate)}), 201


@candidates_bp.post("/bulk-upload-resumes")
@jwt_required()
def bulk_upload_resumes():
    role = get_jwt().get("role")
    BULK_UPLOAD_ALLOWED_ROLES = {
        UserRole.RECRUITER.value,
        UserRole.SR_RECRUITER.value,
        UserRole.M_RECRUITER.value,
        UserRole.ADMIN.value,
    }
    if role not in BULK_UPLOAD_ALLOWED_ROLES:
        return jsonify({"message": "Forbidden"}), 403

    user = _get_current_user()
    if user is None:
        return jsonify({"message": "User not found"}), 404

    # Get jd_id and client_id from form data
    jd_id = request.form.get("jd_id", type=int)
    client_id = request.form.get("client_id", type=int)
    
    if jd_id is None:
        return jsonify({"error": "jd_id is required"}), 400
    
    if client_id is None:
        return jsonify({"error": "client_id is required"}), 400

    # For non-ADMIN roles, enforce client_id match
    if role != UserRole.ADMIN.value:
        if user.client_id != client_id:
            return jsonify({"message": "Forbidden"}), 403

    # Verify access to client and JD
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

    # For RECRUITER role, check JD assignment
    if role == UserRole.RECRUITER.value:
        if not _is_jd_assigned_to_recruiter(jd_id, user.id):
            return jsonify({"message": "JD not assigned to this recruiter"}), 403

    # Get uploaded files
    uploaded_files = request.files.getlist("resumes")
    if not uploaded_files or len(uploaded_files) == 0:
        return jsonify({"error": "No resumes provided"}), 400

    if len(uploaded_files) > 20:
        return jsonify({"error": "Maximum 20 resumes per upload"}), 400

    results = []
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

    for upload_file in uploaded_files:
        result = {
            "filename": upload_file.filename,
            "status": "failed",
            "error": None,
            "extracted": None,
            "candidate": None,
        }

        # Validate filename
        if not upload_file.filename:
            result["error"] = "Invalid filename"
            results.append(result)
            continue

        # Validate extension
        original_filename = upload_file.filename
        ext = os.path.splitext(original_filename)[1].lower()
        if ext not in RESUME_ALLOWED_EXTENSIONS:
            result["error"] = f"Only {', '.join(RESUME_ALLOWED_EXTENSIONS)} files are supported"
            results.append(result)
            continue

        # Validate file size
        file_bytes = upload_file.read()
        if len(file_bytes) > RESUME_MAX_UPLOAD_BYTES:
            result["error"] = f"File size must be {RESUME_MAX_UPLOAD_BYTES // (1024*1024)}MB or less"
            results.append(result)
            continue

        # Extract text from file
        try:
            if ext == ".pdf":
                extracted_text = extract_text_from_pdf(file_bytes)
            elif ext == ".docx":
                extracted_text = extract_text_from_docx(file_bytes)
            else:
                result["error"] = "Unsupported resume format"
                results.append(result)
                continue

            if not extracted_text:
                result["error"] = "Unable to extract text from resume"
                results.append(result)
                continue
        except Exception as err:
            result["error"] = f"Failed to extract text: {str(err)}"
            results.append(result)
            continue

        # Extract details using AI
        try:
            extracted = _extract_resume_fields_with_ai(extracted_text)
        except RuntimeError as err:
            result["error"] = str(err)
            results.append(result)
            continue

        extracted_full_name = extracted.get("full_name")
        extracted_email = extracted.get("email")
        extracted_phone = extracted.get("phone")
        extracted_skills = extracted.get("skills") or []

        # Normalize extracted data
        extracted_full_name = extracted_full_name.strip() if isinstance(extracted_full_name, str) else None
        extracted_email = extracted_email.strip().lower() if isinstance(extracted_email, str) else None
        extracted_phone = extracted_phone.strip() if isinstance(extracted_phone, str) else None
        if not isinstance(extracted_skills, list):
            extracted_skills = []

        # Check cooling period
        if extracted_email:
            is_blocked, unblock_date = _check_cooling_period(extracted_email, jd_id)
            if is_blocked:
                result["status"] = "rejected"
                result["error"] = f"Candidate was not selected for this JD within the last 30 days. Re-apply allowed after {unblock_date}."
                result["extracted"] = {
                    "full_name": extracted_full_name,
                    "email": extracted_email,
                    "phone": extracted_phone,
                    "skills": extracted_skills,
                }
                results.append(result)
                continue

            # Check if candidate already exists for this JD
            existing_candidate = Candidate.query.filter(
                db.func.lower(Candidate.email) == extracted_email,
                Candidate.jd_id == jd_id,
                Candidate.status != 'NOT_SELECTED',  # Allow NOT_SELECTED if old
            ).first()

            if existing_candidate:
                # Make sure it's not just an old NOT_SELECTED
                if existing_candidate.status != 'NOT_SELECTED' or (
                    existing_candidate.status_updated_at and
                    existing_candidate.status_updated_at >= datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=30)
                ):
                    result["status"] = "rejected"
                    result["error"] = "Candidate already exists for this JD."
                    result["extracted"] = {
                        "full_name": extracted_full_name,
                        "email": extracted_email,
                        "phone": extracted_phone,
                        "skills": extracted_skills,
                    }
                    results.append(result)
                    continue

        # Store resume file
        safe_name = secure_filename(original_filename)
        timestamp = int(time.time())
        final_filename = f"{timestamp}_{safe_name}"
        relative_path = os.path.join(RESUME_UPLOAD_SUBDIR, final_filename)
        absolute_path = os.path.join(project_root, relative_path)

        os.makedirs(os.path.dirname(absolute_path), exist_ok=True)
        try:
            with open(absolute_path, "wb") as output_file:
                output_file.write(file_bytes)
        except Exception as err:
            result["error"] = f"Failed to store resume: {str(err)}"
            results.append(result)
            continue

        # Create candidate record
        try:
            candidate = Candidate(
                client_id=client_id,
                jd_id=jd_id,
                full_name=extracted_full_name or "Unknown",
                email=extracted_email or f"unknown_{timestamp}@invalid.local",
                resume_url=relative_path,
                resume_filename=safe_name,
                phone=extracted_phone,
                ai_extracted=True,
                status="APPLIED",
                candidate_extracted_skills=extracted_skills if extracted_skills else None,
            )
            db.session.add(candidate)
            db.session.commit()

            result["status"] = "success"
            result["extracted"] = {
                "full_name": extracted_full_name,
                "email": extracted_email,
                "phone": extracted_phone,
                "skills": extracted_skills,
            }
            result["candidate"] = candidate_schema.dump(candidate)
        except IntegrityError:
            db.session.rollback()
            result["status"] = "rejected"
            result["error"] = "Candidate already exists for this JD."
            result["extracted"] = {
                "full_name": extracted_full_name,
                "email": extracted_email,
                "phone": extracted_phone,
                "skills": extracted_skills,
            }
        except Exception as err:
            db.session.rollback()
            result["status"] = "failed"
            result["error"] = f"Failed to create candidate: {str(err)}"
            result["extracted"] = {
                "full_name": extracted_full_name,
                "email": extracted_email,
                "phone": extracted_phone,
                "skills": extracted_skills,
            }

        results.append(result)

    return jsonify({"results": results}), 200


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
        candidate.status_updated_at = datetime.now(timezone.utc).replace(tzinfo=None)

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
