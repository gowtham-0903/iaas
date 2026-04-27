import json
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity
import sqlalchemy as sa

from app.extensions import db
from app.middleware import role_required
from app.models.user import User, UserRole


qc_bp = Blueprint("qc", __name__)

ALLOWED_ROLES = (UserRole.QC.value, UserRole.ADMIN.value)
QC_DASHBOARD_ROLES = (
    UserRole.QC.value,
    UserRole.ADMIN.value,
    UserRole.RECRUITER.value,
    UserRole.SR_RECRUITER.value,
    UserRole.M_RECRUITER.value,
)
VALID_RECOMMENDATIONS = {"STRONG_HIRE", "HIRE", "MAYBE", "NO_HIRE"}
VALIDATION_STATUS_PENDING = "PENDING"
VALIDATION_STATUS_VALIDATED = "VALIDATED"


def _get_current_user() -> Optional[User]:
    user_id = get_jwt_identity()
    if user_id is None:
        return None
    return User.query.get(int(user_id))


def _parse_date_arg(name: str) -> tuple[Optional[date], Optional[Any]]:
    value = request.args.get(name, type=str)
    if not value:
        return None, None

    try:
        return date.fromisoformat(value), None
    except ValueError:
        return None, (jsonify({"errors": {name: ["Invalid date format. Use YYYY-MM-DD."]}}), 400)


def _normalize_json_field(value: Any, default: Any):
    if value is None:
        return default
    if isinstance(value, (list, dict)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return default
    return default


def _to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _average(values: List[float]) -> Optional[float]:
    if not values:
        return None
    return round(sum(values) / len(values), 2)


def _get_reviewable_interview(interview_id: int):
    sql = sa.text(
        """
        SELECT
            s.id AS interview_id,
            s.scheduled_at,
            s.status AS interview_status,
            c.id AS candidate_id,
            c.full_name AS candidate_name,
            c.email AS candidate_email,
            c.phone AS candidate_phone,
            c.status AS candidate_status,
            j.id AS jd_id,
            j.title AS jd_title,
            cl.id AS client_id,
            cl.name AS client_name,
            t.id AS transcript_id,
            t.upload_type,
            t.uploaded_at,
            ai.id AS ai_score_id,
            ai.overall_score AS ai_overall_score,
            ai.skill_scores AS ai_skill_scores,
            ai.strengths AS ai_strengths,
            ai.concerns AS ai_concerns,
            ai.recommendation AS ai_recommendation,
            ai.generated_at,
            ai.report_status,
            fv.id AS validation_id,
            fv.final_recommendation,
            fv.qc_notes,
            fv.skill_overrides,
            fv.approved,
            fv.status AS validation_status,
            fv.validated_at,
            fv.validated_by
        FROM interview_schedules s
        JOIN candidates c ON c.id = s.candidate_id
        JOIN job_descriptions j ON j.id = s.jd_id
        JOIN clients cl ON cl.id = c.client_id
        JOIN interview_transcripts t ON t.interview_id = s.id
        JOIN ai_interview_scores ai ON ai.interview_id = s.id
        LEFT JOIN feedback_validations fv ON fv.interview_id = s.id
        WHERE s.id = :interview_id
          AND s.status = 'COMPLETED'
          AND ai.report_status = 'GENERATED'
        LIMIT 1
        """
    )
    return db.session.execute(sql, {"interview_id": interview_id}).mappings().first()


def _fetch_jd_skills(jd_id: int) -> List[Dict[str, Any]]:
    rows = db.session.execute(
        sa.text(
            """
            SELECT id, skill_name, skill_type
            FROM jd_skills
            WHERE jd_id = :jd_id
            ORDER BY FIELD(skill_type, 'primary', 'secondary', 'soft'), skill_name
            """
        ),
        {"jd_id": jd_id},
    ).mappings().all()
    return [dict(row) for row in rows]


def _fetch_panelist_scores(interview_id: int) -> List[Dict[str, Any]]:
    rows = db.session.execute(
        sa.text(
            """
            SELECT
                s.panelist_id,
                u.full_name AS panelist_name,
                s.skill_id,
                j.skill_name,
                j.skill_type,
                s.technical_score,
                s.communication_score,
                s.problem_solving_score,
                s.comments,
                s.submitted_at
            FROM interview_scores s
            JOIN users u ON u.id = s.panelist_id
            JOIN jd_skills j ON j.id = s.skill_id
            WHERE s.interview_id = :interview_id
            ORDER BY u.full_name, j.skill_name
            """
        ),
        {"interview_id": interview_id},
    ).mappings().all()
    return [dict(row) for row in rows]


def _fetch_panelist_count(interview_id: int) -> int:
    row = db.session.execute(
        sa.text(
            """
            SELECT COUNT(DISTINCT panelist_id) AS panelist_count
            FROM panel_assignments
            WHERE interview_id = :interview_id
            """
        ),
        {"interview_id": interview_id},
    ).mappings().first()
    return int(row["panelist_count"] or 0) if row else 0


def _build_panelist_payload(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    panelists: Dict[int, Dict[str, Any]] = {}

    for row in rows:
        panelist = panelists.setdefault(
            row["panelist_id"],
            {
                "panelist_id": row["panelist_id"],
                "panelist_name": row["panelist_name"],
                "scores": [],
            },
        )
        panelist["scores"].append(
            {
                "skill_id": row["skill_id"],
                "skill_name": row["skill_name"],
                "skill_type": row["skill_type"],
                "technical_score": row["technical_score"],
                "communication_score": row["communication_score"],
                "problem_solving_score": row["problem_solving_score"],
                "comments": row["comments"],
                "submitted_at": row["submitted_at"].isoformat() if row["submitted_at"] else None,
            }
        )

    return list(panelists.values())


def _build_combined_scores(
    jd_skills: List[Dict[str, Any]],
    panelist_rows: List[Dict[str, Any]],
    ai_skill_scores: List[Dict[str, Any]],
    skill_overrides: Dict[int, float],
) -> Dict[str, Any]:
    panelist_scores_by_skill: Dict[int, List[float]] = {}

    for row in panelist_rows:
        averaged_panelist_score = _average(
            [
                float(row["technical_score"]),
                float(row["communication_score"]),
                float(row["problem_solving_score"]),
            ]
        )
        if averaged_panelist_score is not None:
            panelist_scores_by_skill.setdefault(row["skill_id"], []).append(averaged_panelist_score)

    ai_scores_by_skill: Dict[int, Dict[str, Any]] = {}
    for item in ai_skill_scores:
        skill_id = item.get("skill_id")
        if isinstance(skill_id, int):
            ai_scores_by_skill[skill_id] = {
                "score": _to_float(item.get("score")),
                "reasoning": item.get("reasoning"),
            }

    skills_payload = []
    overall_scores: List[float] = []

    for skill in jd_skills:
        skill_id = skill["id"]
        panelist_average = _average(panelist_scores_by_skill.get(skill_id, []))
        ai_score = ai_scores_by_skill.get(skill_id, {}).get("score")

        raw_combined_score = None
        if panelist_average is not None and ai_score is not None:
            raw_combined_score = round((panelist_average * 0.6) + (ai_score * 0.4), 2)
        elif panelist_average is not None:
            raw_combined_score = round(panelist_average, 2)
        elif ai_score is not None:
            raw_combined_score = round(ai_score, 2)

        final_score = skill_overrides.get(skill_id, raw_combined_score)
        if final_score is not None:
            overall_scores.append(final_score)

        skills_payload.append(
            {
                "skill_id": skill_id,
                "skill_name": skill["skill_name"],
                "skill_type": skill["skill_type"],
                "panelist_average_score": panelist_average,
                "ai_score": ai_score,
                "ai_reasoning": ai_scores_by_skill.get(skill_id, {}).get("reasoning"),
                "raw_combined_score": raw_combined_score,
                "final_score": round(final_score, 2) if final_score is not None else None,
                "is_overridden": skill_id in skill_overrides,
            }
        )

    return {
        "weights": {"panelist": 0.6, "ai": 0.4},
        "overall_score": round(sum(overall_scores) / len(overall_scores), 2) if overall_scores else None,
        "skills": skills_payload,
    }


def _build_review_payload(interview_row: Dict[str, Any]) -> Dict[str, Any]:
    jd_skills = _fetch_jd_skills(interview_row["jd_id"])
    panelist_rows = _fetch_panelist_scores(interview_row["interview_id"])
    panelists = _build_panelist_payload(panelist_rows)

    ai_skill_scores = _normalize_json_field(interview_row["ai_skill_scores"], [])
    ai_strengths = _normalize_json_field(interview_row["ai_strengths"], [])
    ai_concerns = _normalize_json_field(interview_row["ai_concerns"], [])
    raw_skill_overrides = _normalize_json_field(interview_row["skill_overrides"], [])

    skill_overrides: Dict[int, float] = {}
    for item in raw_skill_overrides:
        if isinstance(item, dict) and isinstance(item.get("skill_id"), int):
            final_score = _to_float(item.get("final_score"))
            if final_score is not None:
                skill_overrides[item["skill_id"]] = round(final_score, 2)

    combined_scores = _build_combined_scores(jd_skills, panelist_rows, ai_skill_scores, skill_overrides)
    current_recommendation = interview_row["final_recommendation"] or interview_row["ai_recommendation"]

    return {
        "interview_id": interview_row["interview_id"],
        "interview_date": interview_row["scheduled_at"].isoformat() if interview_row["scheduled_at"] else None,
        "candidate": {
            "id": interview_row["candidate_id"],
            "full_name": interview_row["candidate_name"],
            "email": interview_row["candidate_email"],
            "phone": interview_row["candidate_phone"],
            "status": interview_row["candidate_status"],
            "client_id": interview_row["client_id"],
            "client_name": interview_row["client_name"],
        },
        "jd": {
            "id": interview_row["jd_id"],
            "title": interview_row["jd_title"],
            "skills": jd_skills,
        },
        "panelist_count": _fetch_panelist_count(interview_row["interview_id"]),
        "panelists": panelists,
        "ai_review": {
            "overall_score": _to_float(interview_row["ai_overall_score"]),
            "recommendation": interview_row["ai_recommendation"],
            "strengths": ai_strengths,
            "concerns": ai_concerns,
            "skill_scores": ai_skill_scores,
            "generated_at": interview_row["generated_at"].isoformat() if interview_row["generated_at"] else None,
            "report_status": interview_row["report_status"],
        },
        "combined_scores": combined_scores,
        "review": {
            "validation_id": interview_row["validation_id"],
            "status": interview_row["validation_status"] or VALIDATION_STATUS_PENDING,
            "approved": bool(interview_row["approved"]) if interview_row["approved"] is not None else False,
            "final_recommendation": interview_row["final_recommendation"],
            "current_recommendation": current_recommendation,
            "qc_notes": interview_row["qc_notes"],
            "skill_overrides": raw_skill_overrides if isinstance(raw_skill_overrides, list) else [],
            "validated_at": interview_row["validated_at"].isoformat() if interview_row["validated_at"] else None,
            "validated_by": interview_row["validated_by"],
        },
    }


def _candidate_status_for_recommendation(recommendation: str) -> str:
    if recommendation in {"STRONG_HIRE", "HIRE"}:
        return "SELECTED"
    if recommendation == "NO_HIRE":
        return "NOT_SELECTED"
    return "INTERVIEWED"


@qc_bp.get("/interviews")
@role_required(*ALLOWED_ROLES)
def list_qc_interviews():
    recommendation = request.args.get("recommendation", type=str)
    client_id = request.args.get("client_id", type=int)
    date_from, error = _parse_date_arg("date_from")
    if error:
        return error
    date_to, error = _parse_date_arg("date_to")
    if error:
        return error

    params: Dict[str, Any] = {}
    filters = [
        "s.status = 'COMPLETED'",
        "ai.report_status = 'GENERATED'",
    ]

    if recommendation:
        normalized_recommendation = recommendation.strip().upper()
        if normalized_recommendation not in VALID_RECOMMENDATIONS:
            return jsonify({"errors": {"recommendation": ["Invalid recommendation"]}}), 400
        filters.append("ai.recommendation = :recommendation")
        params["recommendation"] = normalized_recommendation

    if date_from is not None:
        filters.append("DATE(s.scheduled_at) >= :date_from")
        params["date_from"] = date_from

    if date_to is not None:
        filters.append("DATE(s.scheduled_at) <= :date_to")
        params["date_to"] = date_to

    if client_id is not None:
        filters.append("c.client_id = :client_id")
        params["client_id"] = client_id

    sql = """
        SELECT
            s.id,
            c.full_name AS candidate_name,
            j.title AS jd_title,
            cl.name AS client_name,
            s.scheduled_at,
            ai.recommendation AS ai_recommendation,
            COALESCE(fv.status, 'PENDING') AS qc_status,
            COUNT(DISTINCT pa.panelist_id) AS panelist_count
        FROM interview_schedules s
        JOIN candidates c ON c.id = s.candidate_id
        JOIN job_descriptions j ON j.id = s.jd_id
        JOIN clients cl ON cl.id = c.client_id
        JOIN interview_transcripts t ON t.interview_id = s.id
        JOIN ai_interview_scores ai ON ai.interview_id = s.id
        LEFT JOIN feedback_validations fv ON fv.interview_id = s.id
        LEFT JOIN panel_assignments pa ON pa.interview_id = s.id
    """

    if filters:
        sql += " WHERE " + " AND ".join(filters)

    sql += """
        GROUP BY s.id, c.full_name, j.title, cl.name, s.scheduled_at, ai.recommendation, fv.status
        ORDER BY s.scheduled_at DESC, s.id DESC
    """

    rows = db.session.execute(sa.text(sql), params).mappings().all()
    interviews = [
        {
            "id": row["id"],
            "candidate_name": row["candidate_name"],
            "jd_title": row["jd_title"],
            "client_name": row["client_name"],
            "interview_date": row["scheduled_at"].isoformat() if row["scheduled_at"] else None,
            "panelist_count": int(row["panelist_count"] or 0),
            "ai_recommendation": row["ai_recommendation"],
            "qc_status": row["qc_status"],
        }
        for row in rows
    ]
    return jsonify({"interviews": interviews}), 200


@qc_bp.get("/interviews/<int:interview_id>/review")
@role_required(*ALLOWED_ROLES)
def get_qc_review(interview_id: int):
    interview_row = _get_reviewable_interview(interview_id)
    if interview_row is None:
        return jsonify({"error": "Completed interview with transcript and AI score not found"}), 404

    return jsonify(_build_review_payload(interview_row)), 200


@qc_bp.put("/interviews/<int:interview_id>/review")
@role_required(*ALLOWED_ROLES)
def update_qc_review(interview_id: int):
    current_user = _get_current_user()
    if current_user is None:
        return jsonify({"message": "User not found"}), 404

    interview_row = _get_reviewable_interview(interview_id)
    if interview_row is None:
        return jsonify({"error": "Completed interview with transcript and AI score not found"}), 404

    payload = request.get_json(silent=True) or {}
    final_recommendation = payload.get("final_recommendation")
    qc_notes = payload.get("qc_notes")
    approved = payload.get("approved")
    skill_overrides = payload.get("skill_overrides", [])

    if not isinstance(final_recommendation, str) or final_recommendation.strip().upper() not in VALID_RECOMMENDATIONS:
        return jsonify({"errors": {"final_recommendation": ["Invalid final_recommendation"]}}), 400
    final_recommendation = final_recommendation.strip().upper()

    if qc_notes is not None and not isinstance(qc_notes, str):
        return jsonify({"errors": {"qc_notes": ["qc_notes must be a string"]}}), 400

    if not isinstance(approved, bool):
        return jsonify({"errors": {"approved": ["approved must be true or false"]}}), 400

    if not isinstance(skill_overrides, list):
        return jsonify({"errors": {"skill_overrides": ["skill_overrides must be a list"]}}), 400

    jd_skills = _fetch_jd_skills(interview_row["jd_id"])
    jd_skill_ids = {skill["id"] for skill in jd_skills}
    normalized_overrides = []
    seen_skill_ids = set()

    for item in skill_overrides:
        if not isinstance(item, dict):
            return jsonify({"errors": {"skill_overrides": ["Each override must be an object"]}}), 400

        skill_id = item.get("skill_id")
        final_score = _to_float(item.get("final_score"))

        if not isinstance(skill_id, int) or skill_id not in jd_skill_ids:
            return jsonify({"errors": {"skill_overrides": ["skill_id must belong to the interview JD"]}}), 400
        if skill_id in seen_skill_ids:
            return jsonify({"errors": {"skill_overrides": [f"Duplicate skill_id {skill_id}"]}}), 400
        if final_score is None or final_score < 1 or final_score > 10:
            return jsonify({"errors": {"skill_overrides": ["final_score must be between 1 and 10"]}}), 400

        seen_skill_ids.add(skill_id)
        normalized_overrides.append({"skill_id": skill_id, "final_score": round(final_score, 2)})

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    validation_status = VALIDATION_STATUS_VALIDATED if approved else VALIDATION_STATUS_PENDING
    validated_at = now if approved else None
    candidate_status = _candidate_status_for_recommendation(final_recommendation)

    db.session.execute(
        sa.text(
            """
            INSERT INTO feedback_validations
                (interview_id, validated_by, status, final_recommendation, qc_notes,
                 skill_overrides, approved, validated_at, created_at, updated_at)
            VALUES
                (:interview_id, :validated_by, :status, :final_recommendation, :qc_notes,
                 :skill_overrides, :approved, :validated_at, :created_at, :updated_at)
            ON DUPLICATE KEY UPDATE
                validated_by = VALUES(validated_by),
                status = VALUES(status),
                final_recommendation = VALUES(final_recommendation),
                qc_notes = VALUES(qc_notes),
                skill_overrides = VALUES(skill_overrides),
                approved = VALUES(approved),
                validated_at = VALUES(validated_at),
                updated_at = VALUES(updated_at)
            """
        ),
        {
            "interview_id": interview_id,
            "validated_by": current_user.id,
            "status": validation_status,
            "final_recommendation": final_recommendation,
            "qc_notes": qc_notes.strip() if isinstance(qc_notes, str) else None,
            "skill_overrides": json.dumps(normalized_overrides),
            "approved": approved,
            "validated_at": validated_at,
            "created_at": now,
            "updated_at": now,
        },
    )

    db.session.execute(
        sa.text(
            """
            UPDATE candidates
            SET status = :candidate_status
            WHERE id = :candidate_id
            """
        ),
        {
            "candidate_status": candidate_status,
            "candidate_id": interview_row["candidate_id"],
        },
    )
    db.session.commit()

    updated_row = _get_reviewable_interview(interview_id)
    return jsonify(_build_review_payload(updated_row)), 200


@qc_bp.get("/dashboard")
@role_required(*QC_DASHBOARD_ROLES)
def get_qc_dashboard():
    reviewable_filter = """
        s.status = 'COMPLETED'
        AND ai.report_status = 'GENERATED'
        AND t.id IS NOT NULL
    """

    pending_row = db.session.execute(
        sa.text(
            f"""
            SELECT COUNT(DISTINCT s.id) AS pending_reviews
            FROM interview_schedules s
            JOIN interview_transcripts t ON t.interview_id = s.id
            JOIN ai_interview_scores ai ON ai.interview_id = s.id
            LEFT JOIN feedback_validations fv ON fv.interview_id = s.id
            WHERE {reviewable_filter}
              AND COALESCE(fv.approved, 0) = 0
            """
        )
    ).mappings().first()

    approved_today_row = db.session.execute(
        sa.text(
            """
            SELECT COUNT(*) AS approved_today
            FROM feedback_validations
            WHERE approved = 1
              AND DATE(validated_at) = CURRENT_DATE()
            """
        )
    ).mappings().first()

    average_ai_score_row = db.session.execute(
        sa.text(
            f"""
            SELECT AVG(ai.overall_score) AS average_ai_score
            FROM interview_schedules s
            JOIN interview_transcripts t ON t.interview_id = s.id
            JOIN ai_interview_scores ai ON ai.interview_id = s.id
            WHERE {reviewable_filter}
            """
        )
    ).mappings().first()

    recommendation_rows = db.session.execute(
        sa.text(
            f"""
            SELECT
                COALESCE(fv.final_recommendation, ai.recommendation) AS recommendation,
                COUNT(DISTINCT s.id) AS total
            FROM interview_schedules s
            JOIN interview_transcripts t ON t.interview_id = s.id
            JOIN ai_interview_scores ai ON ai.interview_id = s.id
            LEFT JOIN feedback_validations fv ON fv.interview_id = s.id
            WHERE {reviewable_filter}
            GROUP BY COALESCE(fv.final_recommendation, ai.recommendation)
            """
        )
    ).mappings().all()

    recommendation_counts = {key: 0 for key in VALID_RECOMMENDATIONS}
    for row in recommendation_rows:
        recommendation = row["recommendation"]
        if recommendation in recommendation_counts:
            recommendation_counts[recommendation] = int(row["total"] or 0)

    return jsonify(
        {
            "pending_reviews": int(pending_row["pending_reviews"] or 0) if pending_row else 0,
            "approved_today": int(approved_today_row["approved_today"] or 0) if approved_today_row else 0,
            "average_ai_score": round(_to_float(average_ai_score_row["average_ai_score"]) or 0, 2) if average_ai_score_row else 0,
            "recommendation_counts": recommendation_counts,
        }
    ), 200
