import os
import time
import hashlib
from datetime import datetime, timezone
from typing import Optional

from flask import Blueprint, jsonify, request, send_file
from flask_jwt_extended import get_jwt, get_jwt_identity, jwt_required
from marshmallow import ValidationError
from werkzeug.utils import secure_filename

from app.extensions import db, limiter
from app.models.client import Client
from app.models.jd_recruiter_assignment import JDRecruiterAssignment
from app.models.jd_skill import JDSkill
from app.models.job_description import JobDescription
from app.models.user import User, UserRole
from app.services.file_parser import extract_text_from_docx, extract_text_from_pdf
from app.services.skill_extractor import extract_skills_from_text
from app.schemas.jd_schema import (
    jd_schema,
    jd_skill_create_schema,
    jd_skill_update_schema,
    jds_schema,
)


jds_bp = Blueprint("job_descriptions", __name__)

UPLOAD_SUBDIR = os.path.join("uploads", "jd_files")
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_EXTENSIONS = {".pdf", ".docx"}


ALLOWED_RECRUITER_AND_ABOVE = {
    UserRole.RECRUITER.value,
    UserRole.SR_RECRUITER.value,
    UserRole.M_RECRUITER.value,
    UserRole.QC.value,
    UserRole.ADMIN.value,
    UserRole.PANELIST.value,
}

# JD creation requires SR_RECRUITER or above (RECRUITER is view-only per ROLES_AND_ACCESS.md)
JD_CREATE_ROLES = {
    UserRole.RECRUITER.value,
    UserRole.SR_RECRUITER.value,
    UserRole.M_RECRUITER.value,
    UserRole.ADMIN.value,
}


def _get_current_user() -> Optional[User]:
    user_id = get_jwt_identity()
    if user_id is None:
        return None
    return db.session.get(User, int(user_id))


def _get_upload_paths(jd_id, original_filename):
    safe_name = secure_filename(original_filename)
    timestamp = int(time.time())
    final_filename = f"{jd_id}_{timestamp}_{safe_name}"
    relative_path = os.path.join(UPLOAD_SUBDIR, final_filename)
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    absolute_path = os.path.join(project_root, relative_path)
    return relative_path, absolute_path


def _resolve_upload_absolute_path(relative_path):
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    uploads_root = os.path.abspath(os.path.join(project_root, "uploads"))
    candidate_path = os.path.abspath(os.path.join(project_root, relative_path))

    # Prevent path traversal outside uploads root.
    if not candidate_path.startswith(uploads_root + os.sep):
        return None

    return candidate_path


def _is_jd_assigned_to_recruiter(jd_id: int, recruiter_id: int) -> bool:
    assignment = JDRecruiterAssignment.query.filter_by(jd_id=jd_id, recruiter_id=recruiter_id).first()
    return assignment is not None


def _get_accessible_jd(jd_id):
    role = get_jwt().get("role")
    if role not in ALLOWED_RECRUITER_AND_ABOVE:
        return None, (jsonify({"message": "Forbidden"}), 403)

    current_user = _get_current_user()
    if current_user is None:
        return None, (jsonify({"message": "User not found"}), 404)

    jd = db.session.get(JobDescription, jd_id)
    if jd is None:
        return None, (jsonify({"error": "JD not found"}), 404)

    if role == UserRole.RECRUITER.value:
        if current_user.client_id != jd.client_id:
            return None, (jsonify({"message": "Forbidden"}), 403)
        if not _is_jd_assigned_to_recruiter(jd.id, current_user.id):
            return None, (jsonify({"message": "Forbidden"}), 403)

    return jd, None


@jds_bp.post("")
@jwt_required()
def create_jd():
    role = get_jwt().get("role")
    if role not in JD_CREATE_ROLES:
        return jsonify({"message": "Forbidden"}), 403

    payload = request.get_json(silent=True) or {}
    try:
        validated_data = jd_schema.load(payload, partial=("status", "file_url"))
    except ValidationError as err:
        return jsonify({"errors": err.messages}), 400

    current_user = _get_current_user()
    if current_user is None:
        return jsonify({"message": "User not found"}), 404

    client_id = validated_data["client_id"]
    client = db.session.get(Client, client_id)
    if client is None:
        return jsonify({"error": "Client not found"}), 404

    # Non-admin roles can only create JDs for their own client
    if role != UserRole.ADMIN.value and current_user.client_id != client_id:
        return jsonify({"error": "You can only create JDs for your own client"}), 403

    jd = JobDescription(
        client_id=client_id,
        title=validated_data["title"].strip(),
        raw_text=validated_data.get("raw_text"),
        status="DRAFT",
        created_by=current_user.id,
    )
    db.session.add(jd)
    db.session.commit()

    jd.job_code = f"JD-{datetime.now().year}-{str(jd.id).zfill(4)}"
    db.session.commit()

    # Auto-assign RECRUITER who created the JD so they can see it and upload resumes for it
    if role == UserRole.RECRUITER.value:
        try:
            assignment = JDRecruiterAssignment(
                jd_id=jd.id,
                recruiter_id=current_user.id,
                assigned_by=current_user.id,
            )
            db.session.add(assignment)
            db.session.commit()
        except Exception:
            db.session.rollback()

    return jsonify({"jd": jd_schema.dump(jd)}), 201


@jds_bp.get("")
@jwt_required()
def list_jds():
    role = get_jwt().get("role")
    current_user = _get_current_user()
    if current_user is None:
        return jsonify({"message": "User not found"}), 404

    status_filter = request.args.get("status", type=str)
    query = JobDescription.query

    if role == UserRole.RECRUITER.value:
        # Recruiters can see only explicitly assigned JDs.
        assigned_jds = JDRecruiterAssignment.query.filter_by(recruiter_id=current_user.id).with_entities(
            JDRecruiterAssignment.jd_id
        ).all()
        assigned_jd_ids = [assignment.jd_id for assignment in assigned_jds]
        if not assigned_jd_ids:
            return jsonify({"jds": []}), 200
        query = query.filter(JobDescription.id.in_(assigned_jd_ids))
    elif role in {UserRole.ADMIN.value, UserRole.SR_RECRUITER.value, UserRole.M_RECRUITER.value, UserRole.QC.value}:
        pass
    else:
        return jsonify({"message": "Forbidden"}), 403

    if status_filter:
        normalized_status = status_filter.strip().upper()
        if normalized_status not in {"DRAFT", "ACTIVE", "CLOSED"}:
            return jsonify({"errors": {"status": ["Must be one of: DRAFT, ACTIVE, CLOSED"]}}), 400
        query = query.filter(JobDescription.status == normalized_status)

    jds = query.order_by(JobDescription.created_at.desc()).all()
    return jsonify({"jds": jds_schema.dump(jds)}), 200


@jds_bp.get("/<int:jd_id>")
@jwt_required()
def get_jd(jd_id):
    role = get_jwt().get("role")
    current_user = _get_current_user()
    if current_user is None:
        return jsonify({"message": "User not found"}), 404

    jd = db.session.get(JobDescription, jd_id)
    if jd is None:
        return jsonify({"error": "JD not found"}), 404

    if role == UserRole.RECRUITER.value:
        if current_user.client_id != jd.client_id:
            return jsonify({"message": "Forbidden"}), 403
        if not _is_jd_assigned_to_recruiter(jd.id, current_user.id):
            return jsonify({"message": "Forbidden"}), 403

    if role not in ALLOWED_RECRUITER_AND_ABOVE:
        return jsonify({"message": "Forbidden"}), 403

    return jsonify({"jd": jd_schema.dump(jd)}), 200


@jds_bp.put("/<int:jd_id>/status")
@jwt_required()
def update_jd_status(jd_id):
    role = get_jwt().get("role")
    if role not in ALLOWED_RECRUITER_AND_ABOVE:
        return jsonify({"message": "Forbidden"}), 403

    current_user = _get_current_user()
    if current_user is None:
        return jsonify({"message": "User not found"}), 404

    jd = db.session.get(JobDescription, jd_id)
    if jd is None:
        return jsonify({"error": "JD not found"}), 404

    if role == UserRole.RECRUITER.value:
        if current_user.client_id != jd.client_id:
            return jsonify({"message": "Forbidden"}), 403
        if not _is_jd_assigned_to_recruiter(jd.id, current_user.id):
            return jsonify({"message": "Forbidden"}), 403

    payload = request.get_json(silent=True) or {}
    status = payload.get("status")
    if not isinstance(status, str):
        return jsonify({"errors": {"status": ["Not a valid string."]}}), 400

    normalized_status = status.strip().upper()
    if normalized_status not in {"DRAFT", "ACTIVE", "CLOSED"}:
        return jsonify({"errors": {"status": ["Must be one of: DRAFT, ACTIVE, CLOSED"]}}), 400

    jd.status = normalized_status
    db.session.commit()

    return jsonify({"jd": jd_schema.dump(jd)}), 200


@jds_bp.delete("/<int:jd_id>")
@jwt_required()
def close_jd(jd_id):
    role = get_jwt().get("role")
    if role != UserRole.ADMIN.value:
        return jsonify({"message": "Forbidden"}), 403

    jd = db.session.get(JobDescription, jd_id)
    if jd is None:
        return jsonify({"error": "JD not found"}), 404

    jd.status = "CLOSED"
    db.session.commit()

    return jsonify({"message": "JD closed successfully", "jd": jd_schema.dump(jd)}), 200


@jds_bp.post("/<int:jd_id>/upload")
@jwt_required()
def upload_jd_file(jd_id):
    role = get_jwt().get("role")
    if role not in ALLOWED_RECRUITER_AND_ABOVE:
        return jsonify({"message": "Forbidden"}), 403

    current_user = _get_current_user()
    if current_user is None:
        return jsonify({"message": "User not found"}), 404

    jd = db.session.get(JobDescription, jd_id)
    if jd is None:
        return jsonify({"error": "JD not found"}), 404

    if role == UserRole.RECRUITER.value:
        if current_user.client_id != jd.client_id:
            return jsonify({"message": "Forbidden"}), 403
        if not _is_jd_assigned_to_recruiter(jd.id, current_user.id):
            return jsonify({"message": "Forbidden"}), 403

    if jd.status == "CLOSED":
        return jsonify({"error": "Cannot upload files to a closed JD"}), 409

    upload = request.files.get("file")
    if upload is None or not upload.filename:
        return jsonify({"errors": {"file": ["File is required"]}}), 400

    filename = upload.filename
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify({"errors": {"file": ["Only .pdf and .docx are supported"]}}), 400

    file_bytes = upload.read()
    if len(file_bytes) > MAX_UPLOAD_BYTES:
        return jsonify({"errors": {"file": ["File size must be 10MB or less"]}}), 400

    relative_path, absolute_path = _get_upload_paths(jd_id, filename)
    os.makedirs(os.path.dirname(absolute_path), exist_ok=True)
    with open(absolute_path, "wb") as output_file:
        output_file.write(file_bytes)

    if ext == ".pdf":
        extracted_text = extract_text_from_pdf(file_bytes)
    else:
        extracted_text = extract_text_from_docx(file_bytes)

    jd.raw_text = extracted_text
    jd.file_url = relative_path
    db.session.commit()

    return jsonify({"message": "File uploaded", "raw_text_length": len(extracted_text)}), 200


@jds_bp.get("/<int:jd_id>/download")
@jwt_required()
def download_jd_file(jd_id):
    jd, error_response = _get_accessible_jd(jd_id)
    if error_response:
        return error_response

    if not jd.file_url:
        return jsonify({"error": "No uploaded file found for this JD"}), 404

    absolute_path = _resolve_upload_absolute_path(jd.file_url)
    if absolute_path is None or not os.path.exists(absolute_path):
        return jsonify({"error": "Uploaded file not found"}), 404

    original_name = os.path.basename(jd.file_url)
    parts = original_name.split("_", 2)
    download_name = parts[2] if len(parts) == 3 else original_name

    return send_file(absolute_path, as_attachment=True, download_name=download_name)


@jds_bp.post("/<int:jd_id>/extract-skills")
@jwt_required()
@limiter.limit("20 per hour")
def extract_jd_skills(jd_id):
    role = get_jwt().get("role")
    if role not in ALLOWED_RECRUITER_AND_ABOVE:
        return jsonify({"message": "Forbidden"}), 403

    current_user = _get_current_user()
    if current_user is None:
        return jsonify({"message": "User not found"}), 404

    jd = db.session.get(JobDescription, jd_id)
    if jd is None:
        return jsonify({"error": "JD not found"}), 404

    if role == UserRole.RECRUITER.value:
        if current_user.client_id != jd.client_id:
            return jsonify({"message": "Forbidden"}), 403
        if not _is_jd_assigned_to_recruiter(jd.id, current_user.id):
            return jsonify({"message": "Forbidden"}), 403

    if not jd.raw_text or not jd.raw_text.strip():
        return jsonify({"error": "No text to extract from"}), 400

    source_hash = hashlib.sha256(jd.raw_text.encode()).hexdigest()[:16]
    existing_skills = JDSkill.query.filter_by(jd_id=jd.id).order_by(JDSkill.id.asc()).all()
    if jd.skills_extraction_hash == source_hash and existing_skills:
        return jsonify(
            {
                "skills": [
                    {
                        "id": skill.id,
                        "jd_id": skill.jd_id,
                        "skill_name": skill.skill_name,
                        "skill_type": skill.skill_type,
                        "importance_level": skill.importance_level,
                        "subtopics": skill.subtopics,
                    }
                    for skill in existing_skills
                ],
                "cached": True,
                "extracted_at": jd.skills_extracted_at.isoformat() if jd.skills_extracted_at else None,
            }
        ), 200

    try:
        extracted = extract_skills_from_text(jd.raw_text)
    except Exception:
        return jsonify({"error": "AI extraction failed", "can_add_manually": True}), 503

    JDSkill.query.filter_by(jd_id=jd.id).delete()

    saved_skills = []
    primary_skills = extracted.get("primary_skills") or []
    secondary_skills = extracted.get("secondary_skills") or []
    soft_skills = extracted.get("soft_skills") or []

    for item in primary_skills:
        skill = JDSkill(
            jd_id=jd.id,
            skill_name=(item.get("skill_name") or "").strip(),
            skill_type="primary",
            importance_level=item.get("importance_level"),
            subtopics=item.get("subtopics") or [],
        )
        db.session.add(skill)
        saved_skills.append(skill)

    for item in secondary_skills:
        skill = JDSkill(
            jd_id=jd.id,
            skill_name=(item.get("skill_name") or "").strip(),
            skill_type="secondary",
            importance_level=item.get("importance_level"),
            subtopics=item.get("subtopics") or [],
        )
        db.session.add(skill)
        saved_skills.append(skill)

    for item in soft_skills:
        skill = JDSkill(
            jd_id=jd.id,
            skill_name=(item.get("skill_name") or "").strip(),
            skill_type="soft",
            importance_level=item.get("importance_level"),
            subtopics=item.get("subtopics") or [],
        )
        db.session.add(skill)
        saved_skills.append(skill)

    jd.skills_extraction_hash = source_hash
    jd.skills_extracted_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.session.commit()

    response_skills = [
        {
            "id": skill.id,
            "jd_id": skill.jd_id,
            "skill_name": skill.skill_name,
            "skill_type": skill.skill_type,
            "importance_level": skill.importance_level,
            "subtopics": skill.subtopics,
        }
        for skill in saved_skills
    ]
    return jsonify({"skills": response_skills}), 200


@jds_bp.get("/<int:jd_id>/skills")
@jwt_required()
def list_jd_skills(jd_id):
    jd, error_response = _get_accessible_jd(jd_id)
    if error_response:
        return error_response

    skills = JDSkill.query.filter_by(jd_id=jd.id).order_by(JDSkill.id.asc()).all()
    response_skills = [
        {
            "id": skill.id,
            "skill_name": skill.skill_name,
            "skill_type": skill.skill_type,
            "importance_level": skill.importance_level,
            "subtopics": skill.subtopics,
        }
        for skill in skills
    ]
    return jsonify({"skills": response_skills}), 200


@jds_bp.post("/<int:jd_id>/skills")
@jwt_required()
def create_jd_skill(jd_id):
    jd, error_response = _get_accessible_jd(jd_id)
    if error_response:
        return error_response

    payload = request.get_json(silent=True) or {}
    try:
        validated_data = jd_skill_create_schema.load(payload)
    except ValidationError as err:
        return jsonify({"errors": err.messages}), 400

    skill = JDSkill(
        jd_id=jd.id,
        skill_name=validated_data["skill_name"].strip(),
        skill_type=validated_data["skill_type"],
        importance_level=validated_data.get("importance_level"),
        subtopics=validated_data.get("subtopics") or [],
    )
    db.session.add(skill)
    db.session.commit()

    return (
        jsonify(
            {
                "skill": {
                    "id": skill.id,
                    "skill_name": skill.skill_name,
                    "skill_type": skill.skill_type,
                    "importance_level": skill.importance_level,
                    "subtopics": skill.subtopics,
                }
            }
        ),
        201,
    )


@jds_bp.put("/<int:jd_id>/skills/<int:skill_id>")
@jwt_required()
def update_jd_skill(jd_id, skill_id):
    jd, error_response = _get_accessible_jd(jd_id)
    if error_response:
        return error_response

    skill = JDSkill.query.filter_by(id=skill_id, jd_id=jd.id).first()
    if skill is None:
        return jsonify({"error": "Skill not found"}), 404

    payload = request.get_json(silent=True) or {}
    try:
        validated_data = jd_skill_update_schema.load(payload)
    except ValidationError as err:
        return jsonify({"errors": err.messages}), 400

    skill.skill_name = validated_data["skill_name"].strip()
    if validated_data.get("skill_type") is not None:
        skill.skill_type = validated_data["skill_type"]
    skill.importance_level = validated_data.get("importance_level")
    skill.subtopics = validated_data.get("subtopics") or []
    db.session.commit()

    return (
        jsonify(
            {
                "skill": {
                    "id": skill.id,
                    "skill_name": skill.skill_name,
                    "skill_type": skill.skill_type,
                    "importance_level": skill.importance_level,
                    "subtopics": skill.subtopics,
                }
            }
        ),
        200,
    )


@jds_bp.delete("/<int:jd_id>/skills/<int:skill_id>")
@jwt_required()
def delete_jd_skill(jd_id, skill_id):
    jd, error_response = _get_accessible_jd(jd_id)
    if error_response:
        return error_response

    skill = JDSkill.query.filter_by(id=skill_id, jd_id=jd.id).first()
    if skill is None:
        return jsonify({"error": "Skill not found"}), 404

    db.session.delete(skill)
    db.session.commit()
    return jsonify({"message": "Skill deleted successfully"}), 200


@jds_bp.post("/assign-recruiters")
@jwt_required()
def assign_recruiters():
    role = get_jwt().get("role")
    if role not in {UserRole.ADMIN.value, UserRole.SR_RECRUITER.value, UserRole.M_RECRUITER.value}:
        return jsonify({"message": "Forbidden"}), 403

    current_user = _get_current_user()
    if current_user is None:
        return jsonify({"message": "User not found"}), 404

    payload = request.get_json(silent=True) or {}
    jd_id = payload.get("jd_id")
    recruiter_ids = payload.get("recruiter_ids", [])

    if not isinstance(jd_id, int) or jd_id <= 0:
        return jsonify({"errors": {"jd_id": ["jd_id must be a positive integer"]}}), 400

    if not isinstance(recruiter_ids, list) or not recruiter_ids:
        return jsonify({"errors": {"recruiter_ids": ["recruiter_ids must be a non-empty list"]}}), 400

    jd = db.session.get(JobDescription, jd_id)
    if jd is None:
        return jsonify({"error": "JD not found"}), 404

    # Validate all recruiter IDs exist and have RECRUITER role
    recruiters = User.query.filter(User.id.in_(recruiter_ids)).all()
    if len(recruiters) != len(recruiter_ids):
        return jsonify({"error": "One or more recruiter IDs not found"}), 404

    invalid_roles = [r.email for r in recruiters if r.role != UserRole.RECRUITER.value]
    if invalid_roles:
        return jsonify({"error": f"Users {invalid_roles} do not have RECRUITER role"}), 400

    # Delete existing assignments for this JD
    JDRecruiterAssignment.query.filter_by(jd_id=jd_id).delete()

    # Create new assignments
    assignments = []
    for recruiter_id in recruiter_ids:
        assignment = JDRecruiterAssignment(
            jd_id=jd_id,
            recruiter_id=recruiter_id,
            assigned_by=current_user.id,
        )
        db.session.add(assignment)
        assignments.append(assignment)

    db.session.commit()

    return (
        jsonify(
            {
                "message": f"Assigned {len(assignments)} recruiter(s) to JD",
                "assignments": [
                    {
                        "id": a.id,
                        "jd_id": a.jd_id,
                        "recruiter_id": a.recruiter_id,
                        "assigned_by": a.assigned_by,
                        "created_at": a.created_at.isoformat(),
                    }
                    for a in assignments
                ],
            }
        ),
        201,
    )
