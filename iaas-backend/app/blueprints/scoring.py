import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt, get_jwt_identity, jwt_required
import sqlalchemy as sa
from werkzeug.utils import secure_filename

from app.extensions import db
from app.models.interview_scoring import InterviewScore
from app.models.user import User, UserRole
from app.services.ai_scorer import generate_interview_score, generate_ai_score
from app.services.file_parser import extract_text_from_docx
from app.services import teams_service


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
FETCH_TRANSCRIPT_ROLES = {
    UserRole.ADMIN.value,
    UserRole.M_RECRUITER.value,
    UserRole.SR_RECRUITER.value,
    UserRole.OPERATOR.value,
}
GENERATE_SCORE_ROLES = {
    UserRole.ADMIN.value,
    UserRole.M_RECRUITER.value,
    UserRole.SR_RECRUITER.value,
    UserRole.QC.value,
}

MAX_TRANSCRIPT_BYTES = 5 * 1024 * 1024
ALLOWED_TRANSCRIPT_EXTENSIONS = {".docx", ".txt", ".vtt"}
TRANSCRIPT_UPLOAD_SUBDIR = os.path.join("uploads", "transcripts")


def _get_current_user() -> Optional[User]:
    user_id = get_jwt_identity()
    if user_id is None:
        return None
    return db.session.get(User, int(user_id))


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
                "submitted_at": row["submitted_at"].isoformat() if hasattr(row["submitted_at"], "isoformat") else row["submitted_at"] if row["submitted_at"] else None,
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

            panelist = db.session.get(User, override_panelist_id)
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

    for item in normalized_scores:
        existing = db.session.query(InterviewScore).filter_by(
            interview_id=interview_id, panelist_id=panelist_id, skill_id=item["skill_id"]
        ).first()
        if existing:
            existing.technical_score = item["technical_score"]
            existing.communication_score = item["communication_score"]
            existing.problem_solving_score = item["problem_solving_score"]
            existing.comments = item["comments"]
            existing.submitted_at = submitted_at
        else:
            db.session.add(InterviewScore(
                interview_id=interview_id,
                panelist_id=panelist_id,
                skill_id=item["skill_id"],
                technical_score=item["technical_score"],
                communication_score=item["communication_score"],
                problem_solving_score=item["problem_solving_score"],
                comments=item["comments"],
                submitted_at=submitted_at,
            ))

    db.session.commit()

    skill_ids = [item["skill_id"] for item in normalized_scores]
    saved_rows = db.session.execute(
        sa.text(
            """
            SELECT s.id, s.panelist_id, p.name AS panelist_name, s.skill_id, j.skill_name,
                   s.technical_score, s.communication_score, s.problem_solving_score,
                   s.comments, s.submitted_at
            FROM interview_scores s
            JOIN panelists p ON p.id = s.panelist_id
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
        SELECT s.id, s.panelist_id, p.name AS panelist_name, s.skill_id, j.skill_name,
               s.technical_score, s.communication_score, s.problem_solving_score,
               s.comments, s.submitted_at
        FROM interview_scores s
        JOIN panelists p ON p.id = s.panelist_id
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
            else:  # .txt or .vtt
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
        "uploaded_at": transcript["uploaded_at"].isoformat() if hasattr(transcript["uploaded_at"], "isoformat") else transcript["uploaded_at"] if transcript["uploaded_at"] else None,
    }

    return jsonify({"transcript": transcript_payload, "ai_score": ai_result}), 200


@scoring_bp.post("/interviews/<int:interview_id>/fetch-transcript")
@jwt_required()
def fetch_transcript(interview_id: int):
    """Fetch the latest Teams meeting transcript for a completed/in-progress interview.

    Auth: ADMIN, M_RECRUITER, SR_RECRUITER, OPERATOR
    - 400 if interview not found, status invalid, or no teams_meeting_id.
    - 202 if transcript not yet available (Teams takes 5-10 min post-meeting).
    - 200 with { data: { transcript_id, source, preview } } on success.
    """
    role = get_jwt().get("role")
    if role not in FETCH_TRANSCRIPT_ROLES:
        return jsonify({"message": "Forbidden"}), 403

    # --- Validate interview exists and has acceptable status ---------------
    interview_row = db.session.execute(
        sa.text(
            """
            SELECT s.id, s.status, s.teams_meeting_id, s.jd_id
            FROM interview_schedules s
            WHERE s.id = :interview_id
            LIMIT 1
            """
        ),
        {"interview_id": interview_id},
    ).mappings().first()

    if interview_row is None:
        return jsonify({"error": "Interview not found"}), 404

    if interview_row["status"] not in ("COMPLETED", "IN_PROGRESS"):
        return jsonify({
            "error": f"Cannot fetch transcript for an interview with status '{interview_row['status']}'. "
                     "Interview must be COMPLETED or IN_PROGRESS."
        }), 400

    teams_meeting_id = interview_row["teams_meeting_id"]
    if not teams_meeting_id:
        return jsonify({
            "error": "No Teams meeting linked to this interview"
        }), 400

    # --- Call Teams service ------------------------------------------------
    # Resolve organizer_user_id — raises ValueError with clear message if missing
    try:
        import os as _os
        organizer_user_id = _os.getenv("TEAMS_ORGANIZER_USER_ID", "").strip()
        if not organizer_user_id:
            raise ValueError(
                "Teams configuration is incomplete: environment variable "
                "'TEAMS_ORGANIZER_USER_ID' is not set."
            )
        result = teams_service.fetch_meeting_transcript(
            teams_meeting_id=teams_meeting_id,
            organizer_user_id=organizer_user_id,
        )
    except ValueError as ve:
        return jsonify({"error": str(ve)}), 400
    except Exception:
        from flask import current_app
        current_app.logger.exception(
            "Teams transcript fetch failed for interview %s", interview_id
        )
        return jsonify({"error": "Internal server error"}), 500


    # --- Not ready ---------------------------------------------------------
    if result.get("status") == "not_ready":
        return jsonify({"message": result["message"]}), 202

    # --- Success: upsert into interview_transcripts ------------------------
    vtt_raw = result["vtt_raw"]
    parsed_text = result["parsed_text"]
    fetched_at_iso = result["fetched_at"]

    # Parse fetched_at back to a naive UTC datetime for MySQL
    try:
        fetched_at_dt = datetime.fromisoformat(fetched_at_iso.replace("Z", "+00:00"))
        fetched_at_naive = fetched_at_dt.replace(tzinfo=None)
    except Exception:
        fetched_at_naive = datetime.now(timezone.utc).replace(tzinfo=None)

    upsert_sql = sa.text(
        """
        INSERT INTO interview_transcripts
            (interview_id, source, vtt_raw, parsed_text, fetched_at)
        VALUES
            (:interview_id, 'teams_fetch', :vtt_raw, :parsed_text, :fetched_at)
        ON DUPLICATE KEY UPDATE
            source      = 'teams_fetch',
            vtt_raw     = VALUES(vtt_raw),
            parsed_text = VALUES(parsed_text),
            fetched_at  = VALUES(fetched_at)
        """
    )
    db.session.execute(
        upsert_sql,
        {
            "interview_id": interview_id,
            "vtt_raw": vtt_raw,
            "parsed_text": parsed_text,
            "fetched_at": fetched_at_naive,
        },
    )
    db.session.commit()

    # Retrieve the saved row to return its id
    saved_row = db.session.execute(
        sa.text(
            """
            SELECT id, source, parsed_text
            FROM interview_transcripts
            WHERE interview_id = :interview_id
            LIMIT 1
            """
        ),
        {"interview_id": interview_id},
    ).mappings().first()

    preview = (saved_row["parsed_text"] or "")[:500]

    return jsonify({
        "data": {
            "transcript_id": saved_row["id"],
            "source": "teams_fetch",
            "preview": preview,
        },
        "message": "Transcript fetched successfully",
    }), 200


# ---------------------------------------------------------------------------
# GET /api/scoring/interviews/<id>/ai-score
# ---------------------------------------------------------------------------

@scoring_bp.get("/interviews/<int:interview_id>/ai-score")
@jwt_required()
def get_ai_score(interview_id: int):
    role = get_jwt().get("role")
    if role not in SCORE_VIEW_ROLES:
        return jsonify({"message": "Forbidden"}), 403

    interview = _get_interview_row(interview_id)
    if interview is None:
        return jsonify({"error": "Interview not found"}), 404

    row = db.session.execute(
        sa.text(
            """
            SELECT id, interview_id, transcript_id, overall_score,
                   skill_scores, strengths, concerns, recommendation,
                   ai_raw_response, generated_at, report_status,
                   primary_match, secondary_match, skill_breakdown, ai_suggestion
            FROM ai_interview_scores
            WHERE interview_id = :iid LIMIT 1
            """
        ),
        {"iid": interview_id},
    ).mappings().first()

    if row is None:
        return jsonify({"error": "No AI score found for this interview"}), 404

    import json as _json

    def _parse(val):
        if val is None:
            return None
        if isinstance(val, (dict, list)):
            return val
        try:
            return _json.loads(val)
        except Exception:
            return val

    return jsonify({
        "ai_score": {
            "id": row["id"],
            "interview_id": row["interview_id"],
            "transcript_id": row["transcript_id"],
            "overall_score": float(row["overall_score"]) if row["overall_score"] is not None else None,
            "primary_match": float(row["primary_match"]) if row["primary_match"] is not None else None,
            "secondary_match": float(row["secondary_match"]) if row["secondary_match"] is not None else None,
            "skill_scores": _parse(row["skill_scores"]),
            "skill_breakdown": _parse(row["skill_breakdown"]),
            "strengths": _parse(row["strengths"]),
            "concerns": _parse(row["concerns"]),
            "recommendation": row["recommendation"],
            "report_status": row["report_status"],
            "generated_at": row["generated_at"].isoformat() if hasattr(row["generated_at"], "isoformat") else row["generated_at"],
            "ai_suggestion": _parse(row["ai_suggestion"]),
        }
    }), 200


# ---------------------------------------------------------------------------
# POST /api/scoring/interviews/<id>/generate-score
# ---------------------------------------------------------------------------

@scoring_bp.post("/interviews/<int:interview_id>/generate-score")
@jwt_required()
def generate_score(interview_id: int):
    """M4 Phase 2 — full AI scoring engine.

    Auth: ADMIN, M_RECRUITER, SR_RECRUITER, QC
    - 400: not COMPLETED, or no panelist scores
    - 403: wrong role
    - 404: interview not found
    - 409: already GENERATED (use ?regenerate=true to force)
    - 500: AI failed after 3 retries
    - 200: full ai_interview_scores record
    """
    from flask import current_app
    import json as _json

    role = get_jwt().get("role")
    if role not in GENERATE_SCORE_ROLES:
        return jsonify({"message": "Forbidden"}), 403

    interview_row = db.session.execute(
        sa.text(
            """
            SELECT s.id, s.status, s.jd_id, s.candidate_id
            FROM interview_schedules s
            WHERE s.id = :iid LIMIT 1
            """
        ),
        {"iid": interview_id},
    ).mappings().first()

    if interview_row is None:
        return jsonify({"error": "Interview not found"}), 404

    if interview_row["status"] != "COMPLETED":
        return jsonify({
            "error": f"Interview status is '{interview_row['status']}'. "
                     "AI scoring requires COMPLETED status."
        }), 400

    score_count = db.session.execute(
        sa.text("SELECT COUNT(*) AS cnt FROM interview_scores WHERE interview_id = :iid"),
        {"iid": interview_id},
    ).scalar()

    if not score_count:
        return jsonify({
            "error": "No panelist scores found. At least one panelist must submit scores before generating AI analysis."
        }), 400

    regenerate = request.args.get("regenerate", "").lower() in ("true", "1", "yes")
    existing = db.session.execute(
        sa.text(
            "SELECT id, report_status FROM ai_interview_scores WHERE interview_id = :iid LIMIT 1"
        ),
        {"iid": interview_id},
    ).mappings().first()

    if existing and existing["report_status"] == "GENERATED" and not regenerate:
        return jsonify({
            "error": "AI score already generated for this interview.",
            "hint": "Add ?regenerate=true to regenerate.",
            "existing_id": existing["id"],
        }), 409

    try:
        result = generate_ai_score(interview_id)
    except Exception:
        current_app.logger.exception("generate_ai_score crashed for interview %s", interview_id)
        return jsonify({"error": "Internal server error during AI scoring"}), 500

    if result.get("report_status") == "FAILED":
        return jsonify({
            "error": result.get("error", "AI scoring failed"),
            "report_status": "FAILED",
        }), 500

    saved = db.session.execute(
        sa.text(
            """
            SELECT id, interview_id, transcript_id, overall_score,
                   skill_scores, strengths, concerns, recommendation,
                   ai_raw_response, generated_at, report_status,
                   primary_match, secondary_match, skill_breakdown, ai_suggestion
            FROM ai_interview_scores
            WHERE interview_id = :iid LIMIT 1
            """
        ),
        {"iid": interview_id},
    ).mappings().first()

    def _parse(val):
        if val is None:
            return None
        if isinstance(val, (dict, list)):
            return val
        try:
            return _json.loads(val)
        except Exception:
            return val

    return jsonify({
        "message": "AI score generated successfully",
        "data": {
            "id": saved["id"],
            "interview_id": saved["interview_id"],
            "overall_score": float(saved["overall_score"]) if saved["overall_score"] is not None else None,
            "primary_match": float(saved["primary_match"]) if saved["primary_match"] is not None else None,
            "secondary_match": float(saved["secondary_match"]) if saved["secondary_match"] is not None else None,
            "recommendation": saved["recommendation"],
            "report_status": saved["report_status"],
            "skill_breakdown": _parse(saved["skill_breakdown"]),
            "strengths": _parse(saved["strengths"]),
            "concerns": _parse(saved["concerns"]),
            "generated_at": saved["generated_at"].isoformat() if hasattr(saved["generated_at"], "isoformat") else saved["generated_at"],
            "ai_suggestion": _parse(saved["ai_suggestion"]),
        },
    }), 200


# ---------------------------------------------------------------------------
# GET /api/scoring/interviews/<id>/transcript-info
# ---------------------------------------------------------------------------

@scoring_bp.get("/interviews/<int:interview_id>/transcript-info")
@jwt_required()
def get_transcript_info(interview_id: int):
    """Return transcript metadata + preview for the interview detail panel.

    Returns { transcript: null } when no transcript exists yet.
    Returns { transcript: { source, parsed_text_preview, parsed_text_truncated, fetched_at, uploaded_at } } when present.
    """
    role = get_jwt().get("role")
    if role not in SCORE_VIEW_ROLES:
        return jsonify({"message": "Forbidden"}), 403

    interview = _get_interview_row(interview_id)
    if interview is None:
        return jsonify({"error": "Interview not found"}), 404

    row = db.session.execute(
        sa.text(
            """
            SELECT id, source, upload_type, parsed_text, fetched_at, uploaded_at
            FROM interview_transcripts
            WHERE interview_id = :iid
            LIMIT 1
            """
        ),
        {"iid": interview_id},
    ).mappings().first()

    if row is None:
        return jsonify({"transcript": None}), 200

    parsed_text = row["parsed_text"] or ""
    preview = parsed_text[:1000]

    def _iso(val):
        if val is None:
            return None
        return val.isoformat() if hasattr(val, "isoformat") else val

    return jsonify({
        "transcript": {
            "id": row["id"],
            "source": row["source"],
            "upload_type": row["upload_type"],
            "parsed_text_preview": preview,
            "parsed_text_truncated": len(parsed_text) > 1000,
            "fetched_at": _iso(row["fetched_at"]),
            "uploaded_at": _iso(row["uploaded_at"]),
        }
    }), 200
