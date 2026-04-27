import json
from decimal import Decimal
from typing import Any, Dict, List, Optional

from flask import Blueprint, jsonify
from flask_jwt_extended import get_jwt, jwt_required
import sqlalchemy as sa

from app.extensions import db
from app.models.user import UserRole


client_portal_bp = Blueprint("client_portal", __name__)


def _strict_client_context():
    claims = get_jwt()
    role = claims.get("role")
    client_id = claims.get("client_id")

    if role != UserRole.CLIENT.value:
        return None, (jsonify({"message": "Forbidden"}), 403)

    if not isinstance(client_id, int) or client_id <= 0:
        return None, (jsonify({"message": "Invalid client context"}), 403)

    return {"client_id": client_id}, None


def _normalize_json(value: Any, default: Any):
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


def _get_approved_result_row(candidate_id: int, client_id: int):
    row = db.session.execute(
        sa.text(
            """
            SELECT
                c.id AS candidate_id,
                c.full_name AS candidate_name,
                c.email AS candidate_email,
                c.phone AS candidate_phone,
                c.status AS candidate_status,
                j.id AS jd_id,
                j.title AS jd_title,
                j.job_code,
                s.id AS interview_id,
                s.scheduled_at,
                ai.skill_scores AS ai_skill_scores,
                ai.strengths AS ai_strengths,
                ai.concerns AS ai_concerns,
                fv.final_recommendation,
                fv.qc_notes,
                fv.skill_overrides
            FROM candidates c
            JOIN job_descriptions j ON j.id = c.jd_id
            JOIN interview_schedules s ON s.candidate_id = c.id AND s.jd_id = j.id
            JOIN ai_interview_scores ai ON ai.interview_id = s.id AND ai.report_status = 'GENERATED'
            JOIN feedback_validations fv ON fv.interview_id = s.id AND fv.status = 'VALIDATED' AND fv.approved = 1
            WHERE c.id = :candidate_id
              AND c.client_id = :client_id
              AND s.status = 'COMPLETED'
            ORDER BY s.scheduled_at DESC, s.id DESC
            LIMIT 1
            """
        ),
        {"candidate_id": candidate_id, "client_id": client_id},
    ).mappings().first()
    return row


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


def _fetch_panelist_rows(interview_id: int) -> List[Dict[str, Any]]:
    rows = db.session.execute(
        sa.text(
            """
            SELECT
                skill_id,
                technical_score,
                communication_score,
                problem_solving_score
            FROM interview_scores
            WHERE interview_id = :interview_id
            """
        ),
        {"interview_id": interview_id},
    ).mappings().all()
    return [dict(row) for row in rows]


def _build_skill_breakdown(jd_id: int, interview_id: int, ai_skill_scores_raw: Any, skill_overrides_raw: Any):
    jd_skills = _fetch_jd_skills(jd_id)
    panelist_rows = _fetch_panelist_rows(interview_id)
    ai_skill_scores = _normalize_json(ai_skill_scores_raw, [])
    skill_overrides = _normalize_json(skill_overrides_raw, [])

    panelist_scores_by_skill: Dict[int, List[float]] = {}
    for row in panelist_rows:
        panelist_avg = _average([
            float(row["technical_score"]),
            float(row["communication_score"]),
            float(row["problem_solving_score"]),
        ])
        if panelist_avg is not None:
            panelist_scores_by_skill.setdefault(row["skill_id"], []).append(panelist_avg)

    ai_scores_by_skill: Dict[int, Dict[str, Any]] = {}
    for item in ai_skill_scores:
        if isinstance(item, dict) and isinstance(item.get("skill_id"), int):
            ai_scores_by_skill[item["skill_id"]] = {
                "score": _to_float(item.get("score")),
                "reasoning": item.get("reasoning"),
            }

    overrides_by_skill: Dict[int, float] = {}
    for item in skill_overrides:
        if isinstance(item, dict) and isinstance(item.get("skill_id"), int):
            final_score = _to_float(item.get("final_score"))
            if final_score is not None:
                overrides_by_skill[item["skill_id"]] = round(final_score, 2)

    breakdown = []
    overall_scores = []

    for skill in jd_skills:
        skill_id = skill["id"]
        panelist_avg = _average(panelist_scores_by_skill.get(skill_id, []))
        ai_score = ai_scores_by_skill.get(skill_id, {}).get("score")

        combined_score = None
        if panelist_avg is not None and ai_score is not None:
            combined_score = round((panelist_avg * 0.6) + (ai_score * 0.4), 2)
        elif panelist_avg is not None:
            combined_score = round(panelist_avg, 2)
        elif ai_score is not None:
            combined_score = round(ai_score, 2)

        final_score = overrides_by_skill.get(skill_id, combined_score)
        if final_score is not None:
            overall_scores.append(final_score)

        breakdown.append(
            {
                "skill_id": skill_id,
                "skill_name": skill["skill_name"],
                "skill_type": skill["skill_type"],
                "combined_score": combined_score,
                "final_score": round(final_score, 2) if final_score is not None else None,
            }
        )

    overall_score = round(sum(overall_scores) / len(overall_scores), 2) if overall_scores else None
    return breakdown, overall_score


@client_portal_bp.get("/dashboard")
@jwt_required()
def get_dashboard():
    context, error = _strict_client_context()
    if error:
        return error

    client_id = context["client_id"]

    jd_rows = db.session.execute(
        sa.text(
            """
            SELECT
                j.id AS jd_id,
                j.title AS jd_title,
                j.job_code,
                COUNT(DISTINCT c.id) AS total_candidates,
                COUNT(DISTINCT CASE WHEN s.status = 'SCHEDULED' THEN s.id END) AS interviews_scheduled,
                COUNT(DISTINCT CASE WHEN s.status = 'COMPLETED' THEN s.id END) AS interviews_completed,
                COUNT(DISTINCT CASE WHEN s.status = 'CANCELLED' THEN s.id END) AS interviews_cancelled,
                COUNT(
                    DISTINCT CASE
                        WHEN s.status = 'SCHEDULED' AND s.scheduled_at < NOW()
                        THEN s.id
                    END
                ) AS interviews_overdue,
                COUNT(DISTINCT CASE WHEN c.status = 'SELECTED' THEN c.id END) AS selected,
                COUNT(DISTINCT CASE WHEN c.status = 'NOT_SELECTED' THEN c.id END) AS not_selected,
                COUNT(
                    DISTINCT CASE
                        WHEN s.status = 'COMPLETED'
                         AND NOT EXISTS (
                             SELECT 1
                             FROM feedback_validations fv
                             WHERE fv.interview_id = s.id
                               AND fv.status = 'VALIDATED'
                               AND fv.approved = 1
                         )
                        THEN s.id
                    END
                ) AS pending_results
            FROM job_descriptions j
            LEFT JOIN candidates c ON c.jd_id = j.id AND c.client_id = j.client_id
            LEFT JOIN interview_schedules s ON s.candidate_id = c.id AND s.jd_id = j.id
            WHERE j.client_id = :client_id
            GROUP BY j.id, j.title, j.job_code
            ORDER BY j.title
            """
        ),
        {"client_id": client_id},
    ).mappings().all()

    overall_row = db.session.execute(
        sa.text(
            """
            SELECT
                COUNT(DISTINCT j.id) AS total_jds,
                COUNT(DISTINCT c.id) AS total_candidates,
                COUNT(DISTINCT s.id) AS total_interviews,
                COUNT(DISTINCT CASE WHEN c.status = 'SELECTED' THEN c.id END) AS total_selected,
                COUNT(DISTINCT CASE WHEN c.status = 'NOT_SELECTED' THEN c.id END) AS total_not_selected
            FROM job_descriptions j
            LEFT JOIN candidates c ON c.jd_id = j.id AND c.client_id = j.client_id
            LEFT JOIN interview_schedules s ON s.candidate_id = c.id AND s.jd_id = j.id
            WHERE j.client_id = :client_id
            """
        ),
        {"client_id": client_id},
    ).mappings().first()

    return jsonify(
        {
            "jd_summary": [
                {
                    "jd_id": row["jd_id"],
                    "jd_title": row["jd_title"],
                    "job_code": row["job_code"],
                    "total_candidates": int(row["total_candidates"] or 0),
                    "interviews_scheduled": int(row["interviews_scheduled"] or 0),
                    "interviews_completed": int(row["interviews_completed"] or 0),
                    "interviews_cancelled": int(row["interviews_cancelled"] or 0),
                    "interviews_overdue": int(row["interviews_overdue"] or 0),
                    "interviews_not_completed": int(row["interviews_overdue"] or 0),
                    "selected": int(row["selected"] or 0),
                    "not_selected": int(row["not_selected"] or 0),
                    "results_pending_validation": int(row["pending_results"] or 0),
                }
                for row in jd_rows
            ],
            "overall": {
                "total_jds": int(overall_row["total_jds"] or 0) if overall_row else 0,
                "total_candidates": int(overall_row["total_candidates"] or 0) if overall_row else 0,
                "total_interviews": int(overall_row["total_interviews"] or 0) if overall_row else 0,
                "total_selected": int(overall_row["total_selected"] or 0) if overall_row else 0,
                "total_not_selected": int(overall_row["total_not_selected"] or 0) if overall_row else 0,
            },
        }
    ), 200


@client_portal_bp.get("/results")
@jwt_required()
def list_results():
    context, error = _strict_client_context()
    if error:
        return error

    client_id = context["client_id"]
    rows = db.session.execute(
        sa.text(
            """
            SELECT
                j.id AS jd_id,
                j.title AS jd_title,
                j.job_code,
                c.id AS candidate_id,
                c.full_name AS candidate_name,
                c.email AS candidate_email,
                s.id AS interview_id,
                s.scheduled_at,
                fv.final_recommendation,
                fv.qc_notes,
                ai.skill_scores AS ai_skill_scores,
                fv.skill_overrides
            FROM feedback_validations fv
            JOIN interview_schedules s ON s.id = fv.interview_id AND s.status = 'COMPLETED'
            JOIN candidates c ON c.id = s.candidate_id
            JOIN job_descriptions j ON j.id = s.jd_id
            JOIN ai_interview_scores ai ON ai.interview_id = s.id AND ai.report_status = 'GENERATED'
            WHERE fv.status = 'VALIDATED'
              AND fv.approved = 1
              AND c.client_id = :client_id
            ORDER BY j.title, s.scheduled_at DESC, c.full_name
            """
        ),
        {"client_id": client_id},
    ).mappings().all()

    grouped: Dict[int, Dict[str, Any]] = {}
    for row in rows:
        skill_breakdown, overall_score = _build_skill_breakdown(
            row["jd_id"],
            row["interview_id"],
            row["ai_skill_scores"],
            row["skill_overrides"],
        )
        _ = skill_breakdown

        jd_group = grouped.setdefault(
            row["jd_id"],
            {
                "jd_id": row["jd_id"],
                "jd_title": row["jd_title"],
                "job_code": row["job_code"],
                "results": [],
            },
        )
        jd_group["results"].append(
            {
                "candidate_id": row["candidate_id"],
                "candidate_name": row["candidate_name"],
                "candidate_email": row["candidate_email"],
                "final_recommendation": row["final_recommendation"],
                "combined_score": overall_score,
                "qc_notes": row["qc_notes"],
                "interview_date": row["scheduled_at"].isoformat() if row["scheduled_at"] else None,
            }
        )

    return jsonify({"results": list(grouped.values())}), 200


@client_portal_bp.get("/results/<int:candidate_id>/report")
@jwt_required()
def get_candidate_report(candidate_id: int):
    context, error = _strict_client_context()
    if error:
        return error

    client_id = context["client_id"]
    row = _get_approved_result_row(candidate_id, client_id)
    if row is None:
        return jsonify({"error": "Approved result not found"}), 404

    skill_breakdown, overall_score = _build_skill_breakdown(
        row["jd_id"],
        row["interview_id"],
        row["ai_skill_scores"],
        row["skill_overrides"],
    )

    return jsonify(
        {
            "candidate": {
                "id": row["candidate_id"],
                "full_name": row["candidate_name"],
                "email": row["candidate_email"],
                "phone": row["candidate_phone"],
                "status": row["candidate_status"],
            },
            "jd": {
                "id": row["jd_id"],
                "title": row["jd_title"],
                "job_code": row["job_code"],
            },
            "interview_date": row["scheduled_at"].isoformat() if row["scheduled_at"] else None,
            "final_recommendation": row["final_recommendation"],
            "overall_score": overall_score,
            "skill_breakdown": skill_breakdown,
            "summary": "Detailed AI report format is still being finalized. This is a placeholder summary for the approved result.",
            "strengths": _normalize_json(row["ai_strengths"], []),
            "areas_for_development": _normalize_json(row["ai_concerns"], []),
            "qc_notes": row["qc_notes"],
        }
    ), 200
