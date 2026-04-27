import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt, get_jwt_identity, jwt_required
import sqlalchemy as sa
from werkzeug.utils import secure_filename

from app.extensions import db
from app.models.user import User, UserRole
from app.services.ai_scorer import generate_interview_score
from app.services.file_parser import extract_text_from_docx


scoring_bp = Blueprint("scoring", __name__)

SCORE_SUBMIT_ROLES = {UserRole.PANELIST.value, UserRole.ADMIN.value}
SCORE_VIEW_ROLES = {
    UserRole.PANELIST.value,
    UserRole.QC.value,
    UserRole.ADMIN.value,
    UserRole.M_RECRUITER.value,
    UserRole.SR_RECRUITER.value,
}
TRANSCRIPT_ROLES = {UserRole.PANELIST.value, UserRole.ADMIN.value}

MAX_TRANSCRIPT_BYTES = 5 * 1024 * 1024
ALLOWED_TRANSCRIPT_EXTENSIONS = {".docx", ".txt"}
TRANSCRIPT_UPLOAD_SUBDIR = os.path.join("uploads", "transcripts")


def _get_current_user() -> Optional[User]:
    user_id = get_jwt_identity()
    if user_id is None:
        return None
    return User.query.get(int(user_id))


def _is_panelist_assigned(interview_id: int, panelist_id: int) -> bool:
    row = db.session.execute(
        sa.text(
            """
            SELECT 1
            FROM panel_assignments
            WHERE interview_id = :interview_id AND panelist_id = :panelist_id
            LIMIT 1
            """
        ),
        {"interview_id": interview_id, "panelist_id": panelist_id},
    ).first()
    return row is not None


def _get_interview_row(interview_id: int):
    return db.session.execute(
        sa.text(
            """
            SELECT s.id, s.jd_id, s.candidate_id, c.client_id
            FROM interview_schedules s
            JOIN candidates c ON c.id = s.candidate_id
            WHERE s.id = :interview_id
            LIMIT 1
            """
        ),
        {"interview_id": interview_id},
    ).mappings().first()


def _score_in_range(value: Any) -> bool:
    return isinstance(value, int) and 1 <= value <= 10


def _get_transcript_paths(interview_id: int, filename: str):
    safe_name = secure_filename(filename)
    timestamp = int(time.time())
    final_name = f"{interview_id}_{timestamp}_{safe_name}"
    relative_path = os.path.join(TRANSCRIPT_UPLOAD_SUBDIR, final_name)
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    absolute_path = os.path.join(project_root, relative_path)
    return safe_name, relative_path, absolute_path


def _group_scores(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    grouped: Dict[int, Dict[str, Any]] = {}
    for row in rows:
        panelist_id = row["panelist_id"]
        panelist_payload = grouped.setdefault(
            panelist_id,
            {
                "panelist_id": panelist_id,
                "panelist_name": row["panelist_name"],
                "scores": [],
            },
        )
        panelist_payload["scores"].append(
            {
                "id": row["id"],
                "skill_id": row["skill_id"],
                "skill_name": row["skill_name"],
                "technical_score": row["technical_score"],
                "communication_score": row["communication_score"],
                "problem_solving_score": row["problem_solving_score"],
                "comments": row["comments"],
                "submitted_at": row["submitted_at"].isoformat() if row["submitted_at"] else None,
            }
        )
    return list(grouped.values())


@scoring_bp.post("/interviews/<int:interview_id>/scores")
@jwt_required()
def submit_scores(interview_id: int):
    role = get_jwt().get("role")
    if role not in SCORE_SUBMIT_ROLES:
        return jsonify({"message": "Forbidden"}), 403

    current_user = _get_current_user()
    if current_user is None:
        return jsonify({"message": "User not found"}), 404

    interview = _get_interview_row(interview_id)
    if interview is None:
        return jsonify({"error": "Interview not found"}), 404

    payload = request.get_json(silent=True) or {}
    scores = payload.get("scores")
    if not isinstance(scores, list) or not scores:
        return jsonify({"errors": {"scores": ["scores must be a non-empty list"]}}), 400

    panelist_id = current_user.id
    if role == UserRole.PANELIST.value:
        if not _is_panelist_assigned(interview_id, panelist_id):
            return jsonify({"message": "Forbidden"}), 403
    else:
        # ADMIN can submit with the documented body shape; panelist_id is optional for admin override.
        override_panelist_id = payload.get("panelist_id")
        if override_panelist_id is not None:
            if not isinstance(override_panelist_id, int) or override_panelist_id <= 0:
                return jsonify({"errors": {"panelist_id": ["panelist_id must be a positive integer"]}}), 400

            panelist = User.query.get(override_panelist_id)
            if panelist is None or panelist.role != UserRole.PANELIST.value:
                return jsonify({"errors": {"panelist_id": ["panelist_id must belong to PANELIST"]}}), 400

            if not _is_panelist_assigned(interview_id, override_panelist_id):
                return jsonify({"errors": {"panelist_id": ["Panelist is not assigned to this interview"]}}), 400

            panelist_id = override_panelist_id

    jd_skills_rows = db.session.execute(
        sa.text(
            """
            SELECT id, skill_name
            FROM jd_skills
            WHERE jd_id = :jd_id
            """
        ),
        {"jd_id": interview["jd_id"]},
    ).mappings().all()
    jd_skill_map = {row["id"]: row["skill_name"] for row in jd_skills_rows}

    normalized_scores = []
    for item in scores:
        if not isinstance(item, dict):
            return jsonify({"errors": {"scores": ["Each score entry must be an object"]}}), 400

        skill_id = item.get("skill_id")
        technical_score = item.get("technical_score")
        communication_score = item.get("communication_score")
        problem_solving_score = item.get("problem_solving_score")
        comments = item.get("comments")

        if not isinstance(skill_id, int) or skill_id <= 0:
            return jsonify({"errors": {"skill_id": ["skill_id must be a positive integer"]}}), 400
        if skill_id not in jd_skill_map:
            return jsonify({"errors": {"skill_id": [f"skill_id {skill_id} does not belong to interview JD"]}}), 400

        if not _score_in_range(technical_score):
            return jsonify({"errors": {"technical_score": ["technical_score must be between 1 and 10"]}}), 400
        if not _score_in_range(communication_score):
            return jsonify({"errors": {"communication_score": ["communication_score must be between 1 and 10"]}}), 400
        if not _score_in_range(problem_solving_score):
            return jsonify({"errors": {"problem_solving_score": ["problem_solving_score must be between 1 and 10"]}}), 400

        normalized_scores.append(
            {
                "skill_id": skill_id,
                "technical_score": technical_score,
                "communication_score": communication_score,
                "problem_solving_score": problem_solving_score,
                "comments": comments if isinstance(comments, str) else None,
            }
        )

    submitted_at = datetime.now(timezone.utc).replace(tzinfo=None)

    upsert_stmt = sa.text(
        """
        INSERT INTO interview_scores
            (interview_id, panelist_id, skill_id, technical_score, communication_score,
             problem_solving_score, comments, submitted_at)
        VALUES
            (:interview_id, :panelist_id, :skill_id, :technical_score, :communication_score,
             :problem_solving_score, :comments, :submitted_at)
        ON DUPLICATE KEY UPDATE
            technical_score = VALUES(technical_score),
            communication_score = VALUES(communication_score),
            problem_solving_score = VALUES(problem_solving_score),
            comments = VALUES(comments),
            submitted_at = VALUES(submitted_at)
        """
    )

    for item in normalized_scores:
        db.session.execute(
            upsert_stmt,
            {
                "interview_id": interview_id,
                "panelist_id": panelist_id,
                "skill_id": item["skill_id"],
                "technical_score": item["technical_score"],
                "communication_score": item["communication_score"],
                "problem_solving_score": item["problem_solving_score"],
                "comments": item["comments"],
                "submitted_at": submitted_at,
            },
        )

    db.session.commit()

    skill_ids = [item["skill_id"] for item in normalized_scores]
    saved_rows = db.session.execute(
        sa.text(
            """
            SELECT s.id, s.panelist_id, u.full_name AS panelist_name, s.skill_id, j.skill_name,
                   s.technical_score, s.communication_score, s.problem_solving_score,
                   s.comments, s.submitted_at
            FROM interview_scores s
            JOIN users u ON u.id = s.panelist_id
            JOIN jd_skills j ON j.id = s.skill_id
            WHERE s.interview_id = :interview_id
              AND s.panelist_id = :panelist_id
              AND s.skill_id IN :skill_ids
            ORDER BY j.skill_name
            """
        ).bindparams(sa.bindparam("skill_ids", expanding=True)),
        {
            "interview_id": interview_id,
            "panelist_id": panelist_id,
            "skill_ids": skill_ids,
        },
    ).mappings().all()

    grouped = _group_scores(saved_rows)
    return jsonify({"panelists": grouped}), 200


@scoring_bp.get("/interviews/<int:interview_id>/scores")
@jwt_required()
def get_scores(interview_id: int):
    role = get_jwt().get("role")
    if role not in SCORE_VIEW_ROLES:
        return jsonify({"message": "Forbidden"}), 403

    current_user = _get_current_user()
    if current_user is None:
        return jsonify({"message": "User not found"}), 404

    interview = _get_interview_row(interview_id)
    if interview is None:
        return jsonify({"error": "Interview not found"}), 404

    base_sql = """
        SELECT s.id, s.panelist_id, u.full_name AS panelist_name, s.skill_id, j.skill_name,
               s.technical_score, s.communication_score, s.problem_solving_score,
               s.comments, s.submitted_at
        FROM interview_scores s
        JOIN users u ON u.id = s.panelist_id
        JOIN jd_skills j ON j.id = s.skill_id
        WHERE s.interview_id = :interview_id
    """
    params: Dict[str, Any] = {"interview_id": interview_id}

    if role == UserRole.PANELIST.value:
        if not _is_panelist_assigned(interview_id, current_user.id):
            return jsonify({"message": "Forbidden"}), 403
        base_sql += " AND s.panelist_id = :panelist_id"
        params["panelist_id"] = current_user.id

    base_sql += " ORDER BY u.full_name, j.skill_name"

    rows = db.session.execute(sa.text(base_sql), params).mappings().all()
    return jsonify({"panelists": _group_scores(rows)}), 200


@scoring_bp.post("/interviews/<int:interview_id>/transcript")
@jwt_required()
def upload_transcript(interview_id: int):
    role = get_jwt().get("role")
    if role not in TRANSCRIPT_ROLES:
        return jsonify({"message": "Forbidden"}), 403

    current_user = _get_current_user()
    if current_user is None:
        return jsonify({"message": "User not found"}), 404

    interview = _get_interview_row(interview_id)
    if interview is None:
        return jsonify({"error": "Interview not found"}), 404

    if role == UserRole.PANELIST.value and not _is_panelist_assigned(interview_id, current_user.id):
        return jsonify({"message": "Forbidden"}), 403

    transcript_text = None
    file_url = None
    upload_type = None

    if request.content_type and "multipart/form-data" in request.content_type:
        upload = request.files.get("file")
        if upload is not None and upload.filename:
            ext = os.path.splitext(upload.filename)[1].lower()
            if ext not in ALLOWED_TRANSCRIPT_EXTENSIONS:
                return jsonify({"errors": {"file": ["Only .docx or .txt files are supported"]}}), 400

            file_bytes = upload.read()
            if len(file_bytes) > MAX_TRANSCRIPT_BYTES:
                return jsonify({"errors": {"file": ["File size must be 5MB or less"]}}), 400

            safe_name, relative_path, absolute_path = _get_transcript_paths(interview_id, upload.filename)
            if not safe_name:
                return jsonify({"errors": {"file": ["Invalid filename"]}}), 400

            os.makedirs(os.path.dirname(absolute_path), exist_ok=True)
            with open(absolute_path, "wb") as output_file:
                output_file.write(file_bytes)

            if ext == ".docx":
                transcript_text = extract_text_from_docx(file_bytes)
            else:
                transcript_text = file_bytes.decode("utf-8", errors="ignore").strip()

            file_url = relative_path
            upload_type = "file"
        else:
            raw_text = request.form.get("raw_text", type=str)
            if not raw_text or not raw_text.strip():
                return jsonify({"errors": {"raw_text": ["Provide either file or raw_text"]}}), 400
            transcript_text = raw_text.strip()
            upload_type = "text"
    else:
        payload = request.get_json(silent=True) or {}
        raw_text = payload.get("raw_text")
        if not isinstance(raw_text, str) or not raw_text.strip():
            return jsonify({"errors": {"raw_text": ["raw_text is required"]}}), 400
        transcript_text = raw_text.strip()
        upload_type = "text"

    if not transcript_text:
        return jsonify({"error": "Transcript text extraction failed"}), 400

    uploaded_at = datetime.now(timezone.utc).replace(tzinfo=None)

    save_stmt = sa.text(
        """
        INSERT INTO interview_transcripts
            (interview_id, uploaded_by, file_url, raw_text, upload_type, uploaded_at)
        VALUES
            (:interview_id, :uploaded_by, :file_url, :raw_text, :upload_type, :uploaded_at)
        ON DUPLICATE KEY UPDATE
            uploaded_by = VALUES(uploaded_by),
            file_url = VALUES(file_url),
            raw_text = VALUES(raw_text),
            upload_type = VALUES(upload_type),
            uploaded_at = VALUES(uploaded_at)
        """
    )

    db.session.execute(
        save_stmt,
        {
            "interview_id": interview_id,
            "uploaded_by": current_user.id,
            "file_url": file_url,
            "raw_text": transcript_text,
            "upload_type": upload_type,
            "uploaded_at": uploaded_at,
        },
    )
    db.session.commit()

    transcript = db.session.execute(
        sa.text(
            """
            SELECT id, interview_id, uploaded_by, file_url, raw_text, upload_type, uploaded_at
            FROM interview_transcripts
            WHERE interview_id = :interview_id
            LIMIT 1
            """
        ),
        {"interview_id": interview_id},
    ).mappings().first()

    jd_skills = db.session.execute(
        sa.text(
            """
            SELECT id, skill_name, skill_type
            FROM jd_skills
            WHERE jd_id = :jd_id
            """
        ),
        {"jd_id": interview["jd_id"]},
    ).mappings().all()

    ai_result = generate_interview_score(
        interview_id=interview_id,
        transcript_text=transcript_text,
        jd_skills=[dict(row) for row in jd_skills],
    )

    transcript_payload = {
        "id": transcript["id"],
        "interview_id": transcript["interview_id"],
        "uploaded_by": transcript["uploaded_by"],
        "file_url": transcript["file_url"],
        "raw_text": transcript["raw_text"],
        "upload_type": transcript["upload_type"],
        "uploaded_at": transcript["uploaded_at"].isoformat() if transcript["uploaded_at"] else None,
    }

    return jsonify({"transcript": transcript_payload, "ai_score": ai_result}), 200
