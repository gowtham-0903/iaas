import json
import os
import time
import hashlib
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
from app.models.operator_client_assignment import OperatorClientAssignment
from app.models.user import User, UserRole
from app.services.email_service import send_resume_upload_notification_to_operator
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


def _normalize_candidate_skills(raw_skills):
    if isinstance(raw_skills, str):
        try:
            raw_skills = json.loads(raw_skills)
        except json.JSONDecodeError:
            return []

    if not isinstance(raw_skills, list):
        return []

    normalized = []
    for skill in raw_skills:
        if isinstance(skill, str):
            cleaned = skill.strip()
            if cleaned:
                normalized.append(cleaned)

    return normalized


def _resolve_upload_absolute_path(relative_path):
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    uploads_root = os.path.abspath(os.path.join(project_root, "uploads"))
    candidate_path = os.path.abspath(os.path.join(project_root, relative_path))

    # Prevent path traversal outside uploads root.
    if not candidate_path.startswith(uploads_root + os.sep):
        return None

    return candidate_path


def _utc_now_naive():
    return datetime.now(timezone.utc).replace(tzinfo=None)


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
    cutoff = _utc_now_naive() - timedelta(days=30)
    
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


def _auto_assign_recruiter_to_jd(jd_id: int, user: User) -> None:
    """Silently adds the uploader to jd_recruiter_assignments if not already assigned."""
    if user.role == UserRole.ADMIN.value:
        return
    existing = JDRecruiterAssignment.query.filter_by(jd_id=jd_id, recruiter_id=user.id).first()
    if existing:
        return
    try:
        assignment = JDRecruiterAssignment(jd_id=jd_id, recruiter_id=user.id, assigned_by=user.id)
        db.session.add(assignment)
        db.session.commit()
    except Exception:
        db.session.rollback()


def _notify_operators(client_id: int, jd: JobDescription, uploader: User, candidate_count: int) -> None:
    try:
        assignments = OperatorClientAssignment.query.filter_by(client_id=client_id).all()
        if not assignments:
            return
        operator_ids = [a.operator_id for a in assignments]
        operators = User.query.filter(User.id.in_(operator_ids), User.is_active == True).all()
        client = Client.query.get(client_id)
        client_name = client.name if client else f"Client #{client_id}"
        for operator in operators:
            send_resume_upload_notification_to_operator(
                operator_email=operator.email,
                operator_name=operator.full_name,
                uploader_name=uploader.full_name,
                client_name=client_name,
                jd_title=jd.title,
                job_code=jd.job_code or "",
                candidate_count=candidate_count,
            )
    except Exception:
        pass  # Notifications are best-effort, never block the main flow


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

    is_multipart = (request.content_type or "").startswith("multipart/form-data")
    if is_multipart:
        payload = {
            "client_id": request.form.get("client_id", type=int),
            "jd_id": request.form.get("jd_id", type=int),
            "full_name": request.form.get("full_name"),
            "email": request.form.get("email"),
            "status": request.form.get("status") or "APPLIED",
        }
        raw_phone = request.form.get("phone")
        raw_skills = request.form.get("candidate_extracted_skills")
        resume_upload = request.files.get("resume")
    else:
        payload = request.get_json(silent=True) or {}
        raw_phone = payload.get("phone")
        raw_skills = payload.get("candidate_extracted_skills")
        resume_upload = request.files.get("resume") if request.files else None

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

    # Explicit duplicate check before insert
    existing = Candidate.query.filter(
        db.func.lower(Candidate.email) == email.strip().lower(),
        Candidate.jd_id == jd_id,
    ).first()
    if existing:
        return jsonify({
            "error": f"Candidate '{email.strip().lower()}' already exists for the JD '{jd.title}'."
        }), 409

    candidate = Candidate(
        client_id=client_id,
        jd_id=jd_id,
        full_name=validated["full_name"].strip(),
        email=email.strip().lower(),
        status=validated.get("status", "APPLIED"),
    )
    db.session.add(candidate)

    normalized_phone = raw_phone.strip() if isinstance(raw_phone, str) and raw_phone.strip() else None
    normalized_skills = _normalize_candidate_skills(raw_skills)
    if normalized_phone:
        candidate.phone = normalized_phone
    if normalized_skills:
        candidate.candidate_extracted_skills = normalized_skills

    stored_resume_path = None
    resume_bytes = None
    resume_safe_name = None
    resume_original_filename = None

    if resume_upload is not None and resume_upload.filename:
        resume_original_filename = resume_upload.filename
        ext = os.path.splitext(resume_original_filename)[1].lower()
        if ext not in RESUME_ALLOWED_EXTENSIONS:
            db.session.rollback()
            return jsonify({"errors": {"resume": ["Only .pdf and .docx are supported"]}}), 400

        resume_bytes = resume_upload.read()
        if len(resume_bytes) > RESUME_MAX_UPLOAD_BYTES:
            db.session.rollback()
            return jsonify({"errors": {"resume": ["File size must be 2MB or less"]}}), 400

    try:
        db.session.flush()

        if resume_bytes is not None and resume_original_filename:
            safe_name, relative_path, absolute_path = _get_resume_upload_paths(candidate.id, resume_original_filename)
            if not safe_name:
                db.session.rollback()
                return jsonify({"errors": {"resume": ["Invalid filename"]}}), 400

            os.makedirs(os.path.dirname(absolute_path), exist_ok=True)
            with open(absolute_path, "wb") as output_file:
                output_file.write(resume_bytes)

            candidate.resume_url = relative_path
            candidate.resume_filename = safe_name
            candidate.resume_uploaded_at = _utc_now_naive()
            stored_resume_path = absolute_path

        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        if stored_resume_path and os.path.exists(stored_resume_path):
            os.remove(stored_resume_path)
        return jsonify({"error": "Candidate already exists for this JD"}), 409
    except Exception as err:
        db.session.rollback()
        if stored_resume_path and os.path.exists(stored_resume_path):
            os.remove(stored_resume_path)
        return jsonify({"error": f"Failed to create candidate: {str(err)}"}), 500

    if stored_resume_path:
        _auto_assign_recruiter_to_jd(jd_id, user)
        _notify_operators(client_id, jd, user, 1)

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

    # Get uploaded files and extract preview data for review before saving.
    uploaded_files = request.files.getlist("resumes")
    if not uploaded_files or len(uploaded_files) == 0:
        return jsonify({"error": "No resumes provided"}), 400

    if len(uploaded_files) > 20:
        return jsonify({"error": "Maximum 20 resumes per upload"}), 400

    results = []
    seen_file_hashes = set()
    seen_emails_in_batch = set()

    for upload_file in uploaded_files:
        result = {
            "filename": upload_file.filename,
            "status": "failed",
            "error": None,
            "extracted": None,
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

        file_hash = hashlib.sha256(file_bytes).hexdigest()
        if file_hash in seen_file_hashes:
            result["status"] = "rejected"
            result["error"] = "Duplicate resume file detected in this upload batch."
            results.append(result)
            continue
        seen_file_hashes.add(file_hash)

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
            if extracted_email in seen_emails_in_batch:
                result["status"] = "rejected"
                result["error"] = "Duplicate candidate email detected in this upload batch."
                result["extracted"] = {
                    "full_name": extracted_full_name,
                    "email": extracted_email,
                    "phone": extracted_phone,
                    "skills": extracted_skills,
                }
                results.append(result)
                continue

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

            # Check if candidate already exists for this JD (any status)
            existing_candidate = Candidate.query.filter(
                db.func.lower(Candidate.email) == extracted_email,
                Candidate.jd_id == jd_id,
            ).first()

            if existing_candidate:
                result["status"] = "rejected"
                result["error"] = f"Candidate '{extracted_email}' already exists for the JD '{jd.title}'."
                result["extracted"] = {
                    "full_name": extracted_full_name,
                    "email": extracted_email,
                    "phone": extracted_phone,
                    "skills": extracted_skills,
                }
                results.append(result)
                continue

            seen_emails_in_batch.add(extracted_email)
        result["status"] = "ready"
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
        candidate.status_updated_at = _utc_now_naive()

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
    candidate.resume_uploaded_at = _utc_now_naive()
    db.session.commit()

    _auto_assign_recruiter_to_jd(candidate.jd_id, user)

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


@candidates_bp.post("/notify-operators")
@jwt_required()
def notify_operators_bulk():
    """Called by frontend after bulk candidate creation completes."""
    role = get_jwt().get("role")
    if role not in RESUME_ALLOWED_ROLES:
        return jsonify({"message": "Forbidden"}), 403

    user = _get_current_user()
    if user is None:
        return jsonify({"message": "User not found"}), 404

    payload = request.get_json(silent=True) or {}
    jd_id = payload.get("jd_id")
    client_id = payload.get("client_id")
    candidate_count = payload.get("candidate_count", 0)

    if not jd_id or not client_id or candidate_count < 1:
        return jsonify({"message": "jd_id, client_id and candidate_count are required"}), 400

    jd = JobDescription.query.get(jd_id)
    if jd is None:
        return jsonify({"error": "JD not found"}), 404

    _notify_operators(client_id, jd, user, candidate_count)

    return jsonify({"message": "Operators notified"}), 200
