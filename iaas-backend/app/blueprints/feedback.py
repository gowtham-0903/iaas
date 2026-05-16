from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

import sqlalchemy as sa
from flask import Blueprint, jsonify, request

from app.extensions import db, limiter
from app.models.interview_schedule import PanelAssignment
from app.models.interview_scoring import InterviewScore

logger = logging.getLogger(__name__)

feedback_bp = Blueprint("feedback", __name__)

_SKILL_TYPE_ORDER = {"primary": 0, "secondary": 1, "soft": 2}
_VALID_RECOMMENDATIONS = {"STRONG_HIRE", "HIRE", "MAYBE", "NO_HIRE"}
_COMMENT_MIN = {"primary": 1000, "secondary": 250, "soft": 250}
_OVERALL_MIN = 500
_CODING_COMMENT_MIN = 1000


def _now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _resolve_token(token: str):
    """
    Lookup panel_assignment by feedback_token.
    Returns (assignment_row, error_response) — exactly one is None.
    """
    row = db.session.execute(
        sa.text(
            """
            SELECT
                pa.interview_id,
                pa.panelist_id,
                pa.feedback_token,
                pa.token_valid_from,
                pa.token_expires_at,
                pa.token_used,
                pa.token_used_at,
                p.name AS panelist_name,
                p.email AS panelist_email,
                s.scheduled_at,
                s.duration_minutes,
                s.timezone AS interview_timezone,
                s.mode AS interview_mode,
                s.jd_id,
                c.full_name AS candidate_name,
                c.email AS candidate_email,
                j.title AS jd_title,
                j.job_code
            FROM panel_assignments pa
            JOIN panelists p ON p.id = pa.panelist_id
            JOIN interview_schedules s ON s.id = pa.interview_id
            JOIN candidates c ON c.id = s.candidate_id
            JOIN job_descriptions j ON j.id = s.jd_id
            WHERE pa.feedback_token = :token
            LIMIT 1
            """
        ),
        {"token": token},
    ).mappings().first()

    if row is None:
        return None, (jsonify({"error": "Feedback link not found"}), 404)

    if row["token_used"]:
        return None, (jsonify({"error": "Feedback already submitted"}), 409)

    now = _now_utc()

    def _parse_dt(val):
        if val is None:
            return None
        if isinstance(val, str):
            try:
                return datetime.fromisoformat(val)
            except ValueError:
                return None
        return val

    valid_from = _parse_dt(row["token_valid_from"])
    if valid_from is not None and now < valid_from:
        return None, (jsonify({
            "error": "Feedback not yet available",
            "available_from": valid_from.isoformat(),
        }), 425)

    expires_at = _parse_dt(row["token_expires_at"])
    if expires_at is not None and now > expires_at:
        return None, (jsonify({"error": "This feedback link has expired"}), 410)

    return row, None


@feedback_bp.get("/<string:token>")
@limiter.limit("30 per hour")
def get_feedback_form(token: str):
    row, error = _resolve_token(token)
    if error:
        return error

    skills = db.session.execute(
        sa.text(
            """
            SELECT id, skill_name, skill_type, subtopics
            FROM jd_skills
            WHERE jd_id = :jd_id
            """
        ),
        {"jd_id": row["jd_id"]},
    ).mappings().all()

    skill_list = sorted(
        [
            {
                "id": s["id"],
                "skill_name": s["skill_name"],
                "skill_type": s["skill_type"],
                "subtopics": s["subtopics"] or [],
            }
            for s in skills
        ],
        key=lambda s: _SKILL_TYPE_ORDER.get(s["skill_type"], 3),
    )

    scheduled_at = row["scheduled_at"]
    return jsonify(
        {
            "panelist_name": row["panelist_name"],
            "panelist_email": row["panelist_email"],
            "candidate_name": row["candidate_name"],
            "candidate_email": row["candidate_email"],
            "jd_title": row["jd_title"],
            "job_code": row["job_code"],
            "interview_scheduled_at": scheduled_at.isoformat() if hasattr(scheduled_at, "isoformat") else scheduled_at,
            "interview_timezone": row["interview_timezone"],
            "interview_mode": row["interview_mode"],
            "skills": skill_list,
        }
    ), 200


@feedback_bp.post("/<string:token>")
@limiter.limit("5 per hour")
def submit_feedback(token: str):
    row, error = _resolve_token(token)
    if error:
        return error

    payload = request.get_json(silent=True) or {}
    scores = payload.get("scores")
    overall_comments = payload.get("overall_comments", "") or ""
    recommendation = payload.get("recommendation", "")

    errors: dict = {}

    if not isinstance(scores, list) or len(scores) == 0:
        errors["scores"] = ["At least one skill score is required"]

    if not isinstance(recommendation, str) or recommendation.strip().upper() not in _VALID_RECOMMENDATIONS:
        errors["recommendation"] = [
            f"recommendation must be one of {', '.join(sorted(_VALID_RECOMMENDATIONS))}"
        ]

    if errors:
        return jsonify({"errors": errors}), 400

    recommendation_normalized = recommendation.strip().upper()

    # Validate each score entry
    score_errors = []
    validated_scores = []
    for i, entry in enumerate(scores):
        if not isinstance(entry, dict):
            score_errors.append(f"scores[{i}]: must be an object")
            continue
        skill_id = entry.get("skill_id")
        score_val = entry.get("score")
        if not isinstance(skill_id, int) or skill_id <= 0:
            score_errors.append(f"scores[{i}]: skill_id must be a positive integer")
            continue
        if not isinstance(score_val, (int, float)) or not (1 <= score_val <= 5):
            score_errors.append(f"scores[{i}]: score must be between 1 and 5")
            continue
        validated_scores.append(
            {
                "skill_id": skill_id,
                "skill_name": entry.get("skill_name", ""),
                "skill_type": entry.get("skill_type", ""),
                "score": int(score_val),
                "comments": entry.get("comments", ""),
            }
        )

    if score_errors:
        return jsonify({"errors": {"scores": score_errors}}), 400

    # Per-skill comment minimum length check
    for entry in validated_scores:
        skill_type = entry.get("skill_type", "")
        comment = (entry.get("comments") or "").strip()
        min_len = _COMMENT_MIN.get(skill_type, 0)
        if len(comment) < min_len:
            return jsonify({
                "error": f"Comment for '{entry.get('skill_name', 'skill')}' must be at least {min_len} characters."
            }), 400

    # Overall comments minimum length check
    overall_comments_stripped = overall_comments.strip() if overall_comments else ""
    if len(overall_comments_stripped) < _OVERALL_MIN:
        return jsonify({"error": f"Overall comments must be at least {_OVERALL_MIN} characters."}), 400

    # Coding section validation
    no_coding = bool(payload.get("no_coding_round", False))
    coding_qa_raw = payload.get("coding_qa") or []
    coding_score_raw = payload.get("coding_score")
    coding_comments_stripped = (payload.get("coding_comments") or "").strip()

    if not no_coding:
        valid_pairs = [
            p for p in coding_qa_raw
            if isinstance(p, dict)
            and (p.get("question") or "").strip()
            and (p.get("answer") or "").strip()
        ]
        if not valid_pairs:
            return jsonify({"error": "At least one coding Q&A pair with question and answer is required."}), 400
        try:
            coding_score_int = int(coding_score_raw)
        except (TypeError, ValueError):
            coding_score_int = None
        if coding_score_int is None or not (1 <= coding_score_int <= 5):
            return jsonify({"error": "A valid coding score (1–5) is required."}), 400
        if len(coding_comments_stripped) < _CODING_COMMENT_MIN:
            return jsonify({"error": f"Coding assessment must be at least {_CODING_COMMENT_MIN} characters."}), 400
    else:
        valid_pairs = []
        coding_score_int = None
        coding_comments_stripped = None

    interview_id = row["interview_id"]
    panelist_id = row["panelist_id"]
    now = _now_utc()

    try:
        for entry in validated_scores:
            existing = db.session.execute(
                sa.text(
                    "SELECT id FROM interview_scores "
                    "WHERE interview_id = :interview_id AND panelist_id = :panelist_id AND skill_id = :skill_id"
                ),
                {
                    "interview_id": interview_id,
                    "panelist_id": panelist_id,
                    "skill_id": entry["skill_id"],
                },
            ).first()

            if existing:
                db.session.execute(
                    sa.text(
                        "UPDATE interview_scores "
                        "SET overall_score = :score, "
                        "technical_score = NULL, communication_score = NULL, problem_solving_score = NULL, "
                        "comments = :comments "
                        "WHERE interview_id = :interview_id AND panelist_id = :panelist_id AND skill_id = :skill_id"
                    ),
                    {
                        "score": entry["score"],
                        "comments": entry["comments"],
                        "interview_id": interview_id,
                        "panelist_id": panelist_id,
                        "skill_id": entry["skill_id"],
                    },
                )
            else:
                db.session.execute(
                    sa.text(
                        "INSERT INTO interview_scores "
                        "(interview_id, panelist_id, skill_id, overall_score, comments, submitted_at) "
                        "VALUES (:interview_id, :panelist_id, :skill_id, :score, :comments, :submitted_at)"
                    ),
                    {
                        "interview_id": interview_id,
                        "panelist_id": panelist_id,
                        "skill_id": entry["skill_id"],
                        "score": entry["score"],
                        "comments": entry["comments"],
                        "submitted_at": now,
                    },
                )

        # Persist overall_comments, recommendation, and coding fields; mark token used
        db.session.execute(
            sa.text(
                "UPDATE panel_assignments "
                "SET token_used = :used, token_used_at = :used_at, "
                "overall_comments = :overall_comments, recommendation = :recommendation, "
                "no_coding_round = :no_coding_round, coding_qa = :coding_qa, "
                "coding_score = :coding_score, coding_comments = :coding_comments "
                "WHERE interview_id = :interview_id AND panelist_id = :panelist_id"
            ),
            {
                "used": True,
                "used_at": now,
                "overall_comments": overall_comments_stripped or None,
                "recommendation": recommendation_normalized,
                "no_coding_round": no_coding,
                "coding_qa": json.dumps(valid_pairs) if valid_pairs else None,
                "coding_score": coding_score_int,
                "coding_comments": coding_comments_stripped or None,
                "interview_id": interview_id,
                "panelist_id": panelist_id,
            },
        )

        db.session.commit()
    except Exception:
        db.session.rollback()
        logger.exception("Failed to save feedback for token %s", token)
        return jsonify({"error": "Internal server error"}), 500

    return jsonify({"message": "Feedback submitted successfully"}), 201
