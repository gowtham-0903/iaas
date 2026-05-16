import json
import logging
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity
import sqlalchemy as sa

from app.extensions import db
from app.middleware import role_required
from app.models.feedback_validation import FeedbackValidation
from app.models.user import User, UserRole
from app.services.report_distributor import distribute_report


qc_bp = Blueprint("qc", __name__)
logger = logging.getLogger(__name__)

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
    return db.session.get(User, int(user_id))


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
            j.job_code,
            cl.id AS client_id,
            cl.name AS client_name,
            t.id AS transcript_id,
            t.upload_type,
            t.uploaded_at,
            ai.id AS ai_score_id,
            ai.overall_score AS ai_overall_score,
            ai.primary_match,
            ai.secondary_match,
            ai.skill_scores AS ai_skill_scores,
            ai.strengths AS ai_strengths,
            ai.concerns AS ai_concerns,
            ai.recommendation AS ai_recommendation,
            ai.ai_suggestion,
            ai.generated_at,
            ai.report_status,
            ai.report_distributed,
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
        LEFT JOIN interview_transcripts t ON t.interview_id = s.id
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
            ORDER BY CASE skill_type WHEN 'primary' THEN 1 WHEN 'secondary' THEN 2 WHEN 'soft' THEN 3 ELSE 4 END, skill_name
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
                p.name AS panelist_name,
                s.skill_id,
                j.skill_name,
                j.skill_type,
                s.overall_score,
                s.technical_score,
                s.communication_score,
                s.problem_solving_score,
                s.comments,
                s.submitted_at
            FROM interview_scores s
            JOIN panelists p ON p.id = s.panelist_id
            JOIN jd_skills j ON j.id = s.skill_id
            WHERE s.interview_id = :interview_id
            ORDER BY p.name, j.skill_name
            """
        ),
        {"interview_id": interview_id},
    ).mappings().all()
    return [dict(row) for row in rows]


def _fetch_panel_feedback(interview_id: int) -> List[Dict[str, Any]]:
    rows = db.session.execute(
        sa.text(
            """
            SELECT
                pa.panelist_id,
                p.name AS panelist_name,
                pa.overall_comments,
                pa.recommendation,
                pa.no_coding_round,
                pa.coding_score,
                pa.coding_comments,
                pa.coding_qa
            FROM panel_assignments pa
            JOIN panelists p ON p.id = pa.panelist_id
            WHERE pa.interview_id = :interview_id
            ORDER BY p.name
            """
        ),
        {"interview_id": interview_id},
    ).mappings().all()

    result = []
    for row in rows:
        coding_qa = row["coding_qa"]
        if isinstance(coding_qa, str):
            try:
                coding_qa = json.loads(coding_qa)
            except Exception:
                coding_qa = None
        result.append({
            "panelist_id": row["panelist_id"],
            "panelist_name": row["panelist_name"],
            "overall_comments": row["overall_comments"],
            "recommendation": row["recommendation"],
            "no_coding_round": bool(row["no_coding_round"]) if row["no_coding_round"] is not None else False,
            "coding_score": row["coding_score"],
            "coding_comments": row["coding_comments"],
            "coding_qa": coding_qa,
        })
    return result


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
                "overall_score": row["overall_score"],
                "technical_score": row["technical_score"],
                "communication_score": row["communication_score"],
                "problem_solving_score": row["problem_solving_score"],
                "comments": row["comments"],
                "submitted_at": row["submitted_at"].isoformat() if hasattr(row["submitted_at"], "isoformat") else row["submitted_at"] if row["submitted_at"] else None,
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
        if row["technical_score"] is not None:
            # JWT submission: three sub-scores on 1-10 scale → normalise to 1-5
            score_1_5 = (float(row["technical_score"]) + float(row["communication_score"]) + float(row["problem_solving_score"])) / 6.0
        elif row["overall_score"] is not None:
            # Magic-link feedback: overall_score is already on 1-5 scale
            score_1_5 = float(row["overall_score"])
        else:
            continue
        panelist_scores_by_skill.setdefault(row["skill_id"], []).append(score_1_5)

    # Build name→id lookup for Phase 2 AI scorer which stores skill_name, not skill_id
    skill_name_to_id: Dict[str, int] = {s["skill_name"].lower(): s["id"] for s in jd_skills}

    ai_scores_by_skill: Dict[int, Dict[str, Any]] = {}
    for item in ai_skill_scores:
        skill_id = item.get("skill_id")
        if not isinstance(skill_id, int):
            skill_id = skill_name_to_id.get((item.get("skill_name") or "").lower())
        if isinstance(skill_id, int):
            ai_scores_by_skill[skill_id] = {
                "score": _to_float(item.get("score")),
                "reasoning": item.get("ai_assessment") or item.get("reasoning"),
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
    panel_feedback = _fetch_panel_feedback(interview_row["interview_id"])

    ai_skill_scores = _normalize_json_field(interview_row["ai_skill_scores"], [])
    ai_strengths = _normalize_json_field(interview_row["ai_strengths"], [])
    ai_concerns = _normalize_json_field(interview_row["ai_concerns"], [])
    ai_suggestion = _normalize_json_field(interview_row["ai_suggestion"], None)
    raw_skill_overrides = _normalize_json_field(interview_row["skill_overrides"], [])

    skill_overrides: Dict[int, float] = {}
    for item in raw_skill_overrides:
        if isinstance(item, dict) and isinstance(item.get("skill_id"), int):
            final_score = _to_float(item.get("final_score"))
            if final_score is not None:
                skill_overrides[item["skill_id"]] = round(final_score, 2)

    combined_scores = _build_combined_scores(jd_skills, panelist_rows, ai_skill_scores, skill_overrides)
    current_recommendation = interview_row["final_recommendation"] or interview_row["ai_recommendation"]

    def _iso(val):
        if val is None:
            return None
        return val.isoformat() if hasattr(val, "isoformat") else val

    return {
        "interview_id": interview_row["interview_id"],
        "interview_date": _iso(interview_row["scheduled_at"]),
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
            "job_code": interview_row["job_code"],
            "skills": jd_skills,
        },
        "panelist_count": _fetch_panelist_count(interview_row["interview_id"]),
        "panelists": panelists,
        "panel_feedback": panel_feedback,
        "ai_review": {
            "overall_score": _to_float(interview_row["ai_overall_score"]),
            "primary_match": _to_float(interview_row["primary_match"]),
            "secondary_match": _to_float(interview_row["secondary_match"]),
            "recommendation": interview_row["ai_recommendation"],
            "strengths": ai_strengths,
            "concerns": ai_concerns,
            "skill_scores": ai_skill_scores,
            "ai_suggestion": ai_suggestion,
            "generated_at": _iso(interview_row["generated_at"]),
            "report_status": interview_row["report_status"],
            "report_distributed": bool(interview_row["report_distributed"]) if interview_row["report_distributed"] is not None else False,
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
            "validated_at": _iso(interview_row["validated_at"]),
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
    filters = ["s.status = 'COMPLETED'"]

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
            c.email AS candidate_email,
            j.title AS jd_title,
            j.job_code,
            cl.name AS client_name,
            s.scheduled_at,
            ai.recommendation AS ai_recommendation,
            ai.report_status AS ai_score_status,
            ai.overall_score,
            COALESCE(fv.status, 'PENDING') AS qc_status,
            COALESCE(ai.report_distributed, 0) AS report_distributed,
            COALESCE(fv.approved, 0) AS approved,
            COUNT(DISTINCT pa.panelist_id) AS panelist_count,
            COUNT(DISTINCT isc.panelist_id) AS feedback_count,
            MAX(t.source) AS transcript_source
        FROM interview_schedules s
        JOIN candidates c ON c.id = s.candidate_id
        JOIN job_descriptions j ON j.id = s.jd_id
        JOIN clients cl ON cl.id = c.client_id
        LEFT JOIN interview_transcripts t ON t.interview_id = s.id
        LEFT JOIN ai_interview_scores ai ON ai.interview_id = s.id
        LEFT JOIN feedback_validations fv ON fv.interview_id = s.id
        LEFT JOIN panel_assignments pa ON pa.interview_id = s.id
        LEFT JOIN interview_scores isc ON isc.interview_id = s.id
    """

    if filters:
        sql += " WHERE " + " AND ".join(filters)

    sql += """
        GROUP BY s.id, c.full_name, c.email, j.title, j.job_code, cl.name, s.scheduled_at,
                 ai.recommendation, ai.report_status, ai.overall_score,
                 fv.status, ai.report_distributed, fv.approved
        ORDER BY s.scheduled_at DESC, s.id DESC
    """

    rows = db.session.execute(sa.text(sql), params).mappings().all()

    def _iso(val):
        if val is None:
            return None
        return val.isoformat() if hasattr(val, "isoformat") else val

    interviews = [
        {
            "id": row["id"],
            "candidate_name": row["candidate_name"],
            "candidate_email": row["candidate_email"],
            "jd_title": row["jd_title"],
            "job_code": row["job_code"],
            "client_name": row["client_name"],
            "interview_date": _iso(row["scheduled_at"]),
            "panelist_count": int(row["panelist_count"] or 0),
            "feedback_count": int(row["feedback_count"] or 0),
            "transcript_source": row["transcript_source"],
            "transcript_available": row["transcript_source"] is not None,
            "ai_score_status": row["ai_score_status"],
            "overall_score": _to_float(row["overall_score"]),
            "ai_recommendation": row["ai_recommendation"],
            "qc_status": row["qc_status"],
            "approved": bool(row["approved"]),
            "report_distributed": bool(row["report_distributed"]),
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

    fv = db.session.query(FeedbackValidation).filter_by(interview_id=interview_id).first()
    if fv is None:
        fv = FeedbackValidation(interview_id=interview_id, created_at=now)
        db.session.add(fv)
    fv.validated_by = current_user.id
    fv.status = validation_status
    fv.final_recommendation = final_recommendation
    fv.qc_notes = qc_notes.strip() if isinstance(qc_notes, str) else None
    fv.skill_overrides = json.dumps(normalized_overrides)
    fv.approved = approved
    fv.validated_at = validated_at
    fv.updated_at = now

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

    # --- Trigger distribution on approval ---------------------------------
    if approved:
        try:
            dist_result = distribute_report(
                interview_id=interview_id,
                qc_user_id=current_user.id,
            )
            if not dist_result["success"]:
                logger.warning(
                    "distribute_report failed for interview %s: %s",
                    interview_id,
                    dist_result.get("error"),
                )
        except Exception:
            logger.exception(
                "distribute_report raised for interview %s — approval still committed",
                interview_id,
            )

    updated_row = _get_reviewable_interview(interview_id)
    return jsonify(_build_review_payload(updated_row)), 200


@qc_bp.get("/dashboard")
@role_required(*QC_DASHBOARD_ROLES)
def get_qc_dashboard():
    reviewable_filter = """
        s.status = 'COMPLETED'
        AND ai.report_status = 'GENERATED'
    """

    pending_row = db.session.execute(
        sa.text(
            f"""
            SELECT COUNT(DISTINCT s.id) AS pending_reviews
            FROM interview_schedules s
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
              AND DATE(validated_at) = :today
            """
        ),
        {"today": date.today().isoformat()},
    ).mappings().first()

    average_ai_score_row = db.session.execute(
        sa.text(
            f"""
            SELECT AVG(ai.overall_score) AS average_ai_score
            FROM interview_schedules s
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
            JOIN ai_interview_scores ai ON ai.interview_id = s.id
            LEFT JOIN feedback_validations fv ON fv.interview_id = s.id
            WHERE {reviewable_filter}
            GROUP BY COALESCE(fv.final_recommendation, ai.recommendation)
            """
        )
    ).mappings().all()

    distributed_row = db.session.execute(
        sa.text(
            """
            SELECT COUNT(DISTINCT interview_id) AS distributed_count
            FROM ai_interview_scores
            WHERE report_distributed = 1
            """
        )
    ).mappings().first()

    failed_row = db.session.execute(
        sa.text(
            """
            SELECT COUNT(DISTINCT interview_id) AS failed_count
            FROM ai_interview_scores
            WHERE report_status = 'FAILED'
            """
        )
    ).mappings().first()

    recommendation_counts = {key: 0 for key in VALID_RECOMMENDATIONS}
    for row in recommendation_rows:
        recommendation = row["recommendation"]
        if recommendation in recommendation_counts:
            recommendation_counts[recommendation] = int(row["total"] or 0)

    return jsonify(
        {
            "pending_reviews": int(pending_row["pending_reviews"] or 0) if pending_row else 0,
            "approved_today": int(approved_today_row["approved_today"] or 0) if approved_today_row else 0,
            "distributed_count": int(distributed_row["distributed_count"] or 0) if distributed_row else 0,
            "failed_count": int(failed_row["failed_count"] or 0) if failed_row else 0,
            "average_ai_score": round(_to_float(average_ai_score_row["average_ai_score"]) or 0, 2) if average_ai_score_row else 0,
            "recommendation_counts": recommendation_counts,
        }
    ), 200


# ---------------------------------------------------------------------------
# POST /api/qc/interviews/<id>/distribute  — manual re-send
# ---------------------------------------------------------------------------

DISTRIBUTE_ROLES = (UserRole.QC.value, UserRole.ADMIN.value)


@qc_bp.post("/interviews/<int:interview_id>/distribute")
@role_required(*DISTRIBUTE_ROLES)
def manual_distribute(interview_id: int):
    """Manually (re-)send the approved interview report to the recruiter hierarchy.

    Auth: QC, ADMIN only
    - 400: feedback_validations.approved is False or no FV record
    - 404: interview not found
    - 200: { emails_sent: [...], cc_email: ... }
    """
    current_user = _get_current_user()
    if current_user is None:
        return jsonify({"message": "User not found"}), 404

    interview_check = db.session.execute(
        sa.text("SELECT id FROM interview_schedules WHERE id = :iid LIMIT 1"),
        {"iid": interview_id},
    ).mappings().first()
    if interview_check is None:
        return jsonify({"error": "Interview not found"}), 404

    fv_row = db.session.execute(
        sa.text(
            "SELECT approved FROM feedback_validations WHERE interview_id = :iid LIMIT 1"
        ),
        {"iid": interview_id},
    ).mappings().first()

    if fv_row is None or not fv_row["approved"]:
        return jsonify({
            "error": "Report can only be distributed after QC approval. "
                     "Please approve the validation first."
        }), 400

    try:
        result = distribute_report(
            interview_id=interview_id,
            qc_user_id=current_user.id,
        )
    except Exception:
        logger.exception("manual_distribute: distribute_report raised for interview %s", interview_id)
        return jsonify({"error": "Internal server error during distribution"}), 500

    if not result["success"]:
        return jsonify({
            "message": "Distribution attempted but email delivery failed. Check server logs.",
            "emails_sent": result.get("emails_sent", []),
            "cc_email": result.get("cc_email"),
            "error": result.get("error"),
        }), 207

    return jsonify({
        "message": "Report distributed successfully.",
        "emails_sent": result["emails_sent"],
        "cc_email": result.get("cc_email"),
    }), 200
