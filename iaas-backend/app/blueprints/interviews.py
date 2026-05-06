from __future__ import annotations

from datetime import date, datetime, time, timezone
from typing import Any, Dict, List, Optional

import pytz
from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt, get_jwt_identity, jwt_required
import sqlalchemy as sa

from app.extensions import db, limiter
from app.models.candidate import Candidate
from app.models.jd_recruiter_assignment import JDRecruiterAssignment
from app.models.jd_skill import JDSkill
from app.models.job_description import JobDescription
from app.models.user import User, UserRole
from app.services.email_service import (
    send_interview_notification_to_additional_recipient,
    send_interview_scheduled_to_candidate,
    send_interview_scheduled_to_panelist,
    send_interview_scheduled_to_recruiter,
)
from app.services.teams_service import cancel_teams_interview_event, create_teams_interview_event


interviews_bp = Blueprint("interviews", __name__)

SCHEDULING_ALLOWED_ROLES = {
    UserRole.OPERATOR.value,
    UserRole.ADMIN.value,
    UserRole.M_RECRUITER.value,
    UserRole.SR_RECRUITER.value,
}

LIST_ALLOWED_ROLES = {
    UserRole.OPERATOR.value,
    UserRole.ADMIN.value,
    UserRole.M_RECRUITER.value,
    UserRole.SR_RECRUITER.value,
    UserRole.RECRUITER.value,
    UserRole.PANELIST.value,
}

STATUS_UPDATE_ROLES = {
    UserRole.OPERATOR.value,
    UserRole.ADMIN.value,
    UserRole.M_RECRUITER.value,
    UserRole.SR_RECRUITER.value,
}

AVAILABILITY_WRITE_ROLES = {
    UserRole.PANELIST.value,
    UserRole.ADMIN.value,
}

VALID_INTERVIEW_STATUS = {
    "SCHEDULED",
    "IN_PROGRESS",
    "COMPLETED",
    "CANCELLED",
}

VALID_MODES = {"virtual"}
VALID_TIMEZONES = {
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Phoenix",
    "America/Anchorage",
    "Pacific/Honolulu",
    "Asia/Kolkata",
    "UTC",
}


def _get_current_user() -> Optional[User]:
    user_id = get_jwt_identity()
    if user_id is None:
        return None
    return db.session.get(User, int(user_id))


def _parse_iso_datetime(value: str) -> Optional[datetime]:
    if not isinstance(value, str):
        return None

    normalized = value.strip()
    if not normalized:
        return None

    try:
        parsed = datetime.fromisoformat(normalized.replace("Z", "+00:00"))
    except ValueError:
        return None

    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)

    return parsed


def _parse_local_to_utc(value: str, tz_str: str) -> Optional[datetime]:
    if not isinstance(value, str):
        return None

    normalized = value.strip()
    if not normalized:
        return None

    try:
        naive_dt = datetime.fromisoformat(normalized)
        local_tz = pytz.timezone(tz_str)
        local_aware = local_tz.localize(naive_dt)
        return local_aware.astimezone(pytz.utc).replace(tzinfo=None)
    except Exception:
        return None


def _parse_date(value: str) -> Optional[date]:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _parse_hhmm(value: str) -> Optional[time]:
    if not isinstance(value, str):
        return None
    try:
        parsed = time.fromisoformat(value)
        return parsed.replace(second=0, microsecond=0)
    except ValueError:
        return None


def _iso_format(val: Any) -> Optional[str]:
    """Safely convert date/time/timedelta to ISO string."""
    if val is None:
        return None
    if hasattr(val, "isoformat"):
        return val.isoformat()
    return str(val)


def _convert_utc_to_local(utc_dt: Optional[datetime], tz_str: str) -> Optional[str]:
    if utc_dt is None:
        return None

    try:
        local_tz = pytz.timezone(tz_str or "America/New_York")
        utc_aware = pytz.utc.localize(utc_dt)
        return utc_aware.astimezone(local_tz).isoformat()
    except Exception:
        return None


def _candidate_accessible_for_user(role: str, user: User, candidate: Candidate) -> bool:
    if role in {UserRole.ADMIN.value, UserRole.OPERATOR.value}:
        return True

    if role in {UserRole.M_RECRUITER.value, UserRole.SR_RECRUITER.value, UserRole.RECRUITER.value}:
        return user.client_id is not None and user.client_id == candidate.client_id

    return False


def _fetch_panelists_for_interviews(interview_ids: List[int]) -> Dict[int, List[Dict[str, Any]]]:
    if not interview_ids:
        return {}

    stmt = sa.text(
        """
        SELECT pa.interview_id, u.id AS panelist_id, u.full_name, u.email
        FROM panel_assignments pa
        JOIN users u ON u.id = pa.panelist_id
        WHERE pa.interview_id IN :interview_ids
        ORDER BY pa.interview_id, u.full_name
        """
    ).bindparams(sa.bindparam("interview_ids", expanding=True))

    rows = db.session.execute(stmt, {"interview_ids": interview_ids}).mappings().all()
    grouped: Dict[int, List[Dict[str, Any]]] = {}
    for row in rows:
        grouped.setdefault(row["interview_id"], []).append(
            {
                "id": row["panelist_id"],
                "full_name": row["full_name"],
                "email": row["email"],
            }
        )
    return grouped


def _serialize_interview_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    interview_ids = [row["id"] for row in rows]
    panelists_by_interview = _fetch_panelists_for_interviews(interview_ids)

    payload = []
    for row in rows:
        payload.append(
            {
                "id": row["id"],
                "candidate_id": row["candidate_id"],
                "candidate_name": row["candidate_name"],
                "candidate_email": row["candidate_email"],
                "jd_id": row["jd_id"],
                "jd_title": row["jd_title"],
                "scheduled_at": row["scheduled_at"].isoformat() if hasattr(row["scheduled_at"], "isoformat") else row["scheduled_at"] if row["scheduled_at"] else None,
                "scheduled_at_local": _convert_utc_to_local(row["scheduled_at"], row.get("timezone", "America/New_York")),
                "duration_minutes": row["duration_minutes"],
                "mode": row["mode"],
                "meeting_link": row["meeting_link"],
                "timezone": row.get("timezone", "America/New_York"),
                "external_event_id": row.get("external_event_id"),
                "teams_meeting_id": row.get("teams_meeting_id"),
                "notes": row["notes"],
                "status": row["status"],
                "panelists": panelists_by_interview.get(row["id"], []),
            }
        )
    return payload


def _base_interview_query_sql() -> str:
    return """
        SELECT
            s.id,
            s.candidate_id,
            c.full_name AS candidate_name,
            c.email AS candidate_email,
            s.jd_id,
            j.title AS jd_title,
            s.scheduled_at,
            s.duration_minutes,
            s.mode,
            s.meeting_link,
            s.timezone,
            s.external_event_id,
            s.teams_meeting_id,
            s.notes,
            s.status
        FROM interview_schedules s
        JOIN candidates c ON c.id = s.candidate_id
        JOIN job_descriptions j ON j.id = s.jd_id
    """


def _build_interview_filters(role: str, user: User, include_interview_id: Optional[int] = None):
    filters = []
    params: Dict[str, Any] = {}

    if include_interview_id is not None:
        filters.append("s.id = :interview_id")
        params["interview_id"] = include_interview_id

    status = request.args.get("status", type=str)
    jd_id = request.args.get("jd_id", type=int)
    candidate_id = request.args.get("candidate_id", type=int)
    date_from = request.args.get("date_from", type=str)
    date_to = request.args.get("date_to", type=str)

    if status:
        normalized = status.strip().upper()
        if normalized not in VALID_INTERVIEW_STATUS:
            return None, None, (jsonify({"errors": {"status": ["Invalid status"]}}), 400)
        filters.append("s.status = :status")
        params["status"] = normalized

    if jd_id is not None:
        filters.append("s.jd_id = :jd_id")
        params["jd_id"] = jd_id

    if candidate_id is not None:
        filters.append("s.candidate_id = :candidate_id")
        params["candidate_id"] = candidate_id

    if date_from:
        parsed_from = _parse_date(date_from)
        if parsed_from is None:
            return None, None, (jsonify({"errors": {"date_from": ["Invalid date format"]}}), 400)
        filters.append("DATE(s.scheduled_at) >= :date_from")
        params["date_from"] = parsed_from

    if date_to:
        parsed_to = _parse_date(date_to)
        if parsed_to is None:
            return None, None, (jsonify({"errors": {"date_to": ["Invalid date format"]}}), 400)
        filters.append("DATE(s.scheduled_at) <= :date_to")
        params["date_to"] = parsed_to

    if role in {UserRole.ADMIN.value, UserRole.OPERATOR.value}:
        pass
    elif role == UserRole.PANELIST.value:
        filters.append(
            "EXISTS (SELECT 1 FROM panel_assignments pa_f WHERE pa_f.interview_id = s.id AND pa_f.panelist_id = :panelist_id)"
        )
        params["panelist_id"] = user.id
    elif role in {UserRole.RECRUITER.value, UserRole.SR_RECRUITER.value, UserRole.M_RECRUITER.value}:
        if user.client_id is None:
            filters.append("1 = 0")
        else:
            filters.append("c.client_id = :client_id")
            params["client_id"] = user.client_id
    else:
        return None, None, (jsonify({"message": "Forbidden"}), 403)

    return filters, params, None


def _get_interview_by_id(interview_id: int, role: str, user: User):
    filters, params, error = _build_interview_filters(role, user, include_interview_id=interview_id)
    if error:
        return None, error

    sql = _base_interview_query_sql()
    if filters:
        sql += " WHERE " + " AND ".join(filters)
    sql += " ORDER BY s.id DESC"

    row = db.session.execute(sa.text(sql), params).mappings().first()
    if row is None:
        return None, (jsonify({"error": "Interview not found"}), 404)

    return _serialize_interview_rows([row])[0], None


@interviews_bp.post("")
@jwt_required()
@limiter.limit("20 per hour")
def create_interview():
    role = get_jwt().get("role")
    if role not in SCHEDULING_ALLOWED_ROLES:
        return jsonify({"message": "Forbidden"}), 403

    user = _get_current_user()
    if user is None:
        return jsonify({"message": "User not found"}), 404

    payload = request.get_json(silent=True) or {}

    candidate_id = payload.get("candidate_id")
    jd_id = payload.get("jd_id")
    scheduled_at_raw = payload.get("scheduled_at")
    timezone_str = payload.get("timezone", "America/New_York")
    duration_minutes = payload.get("duration_minutes", 60)
    mode = payload.get("mode")
    panelist_ids = payload.get("panelist_ids")
    notes = payload.get("notes")
    raw_additional_emails = payload.get("additional_emails") or []

    # Normalise and validate additional_emails
    additional_emails: List[str] = []
    if isinstance(raw_additional_emails, list):
        for entry in raw_additional_emails:
            if isinstance(entry, str):
                cleaned = entry.strip().lower()
                if cleaned and "@" in cleaned and "." in cleaned.split("@")[-1]:
                    additional_emails.append(cleaned)

    if not isinstance(candidate_id, int) or candidate_id <= 0:
        return jsonify({"errors": {"candidate_id": ["candidate_id must be a positive integer"]}}), 400

    if not isinstance(jd_id, int) or jd_id <= 0:
        return jsonify({"errors": {"jd_id": ["jd_id must be a positive integer"]}}), 400

    if not isinstance(timezone_str, str) or not timezone_str.strip():
        return jsonify({"errors": {"timezone": ["timezone is required"]}}), 400

    timezone_str = timezone_str.strip()
    if timezone_str not in VALID_TIMEZONES:
        try:
            pytz.timezone(timezone_str)
        except pytz.exceptions.UnknownTimeZoneError:
            return jsonify({"errors": {"timezone": ["Invalid timezone"]}}), 400

    scheduled_at_utc = _parse_local_to_utc(scheduled_at_raw, timezone_str)
    if scheduled_at_utc is None:
        return jsonify({"errors": {"scheduled_at": ["Invalid datetime format"]}}), 400

    if not isinstance(duration_minutes, int) or duration_minutes <= 0:
        return jsonify({"errors": {"duration_minutes": ["duration_minutes must be a positive integer"]}}), 400

    if mode not in VALID_MODES:
        return jsonify({"errors": {"mode": ["mode must be virtual"]}}), 400

    if not isinstance(panelist_ids, list) or not (1 <= len(panelist_ids) <= 3):
        return jsonify({"errors": {"panelist_ids": ["panelist_ids must contain 1 to 3 panelists"]}}), 400

    if any(not isinstance(panelist_id, int) or panelist_id <= 0 for panelist_id in panelist_ids):
        return jsonify({"errors": {"panelist_ids": ["panelist_ids must be positive integers"]}}), 400

    panelist_ids = list(dict.fromkeys(panelist_ids))
    if len(panelist_ids) > 3:
        return jsonify({"errors": {"panelist_ids": ["panelist_ids must contain 1 to 3 panelists"]}}), 400

    candidate = db.session.get(Candidate, candidate_id)
    if candidate is None:
        return jsonify({"error": "Candidate not found"}), 404

    jd = db.session.get(JobDescription, jd_id)
    if jd is None:
        return jsonify({"error": "JD not found"}), 404

    if jd.status != "ACTIVE":
        return jsonify({"error": "Interviews can only be scheduled for an ACTIVE job description."}), 400

    if candidate.jd_id != jd.id:
        return jsonify({"errors": {"jd_id": ["Candidate does not belong to this JD"]}}), 400

    # Fetch JD skills for the candidate invitation email
    raw_skills = JDSkill.query.filter_by(jd_id=jd_id).all()
    jd_skills_for_email = [
        {"skill_name": s.skill_name, "skill_type": s.skill_type, "subtopics": s.subtopics or []}
        for s in raw_skills
    ]
    client_name_for_email = jd.client.name if jd.client else ""

    if not _candidate_accessible_for_user(role, user, candidate):
        return jsonify({"message": "Forbidden"}), 403

    panelists = User.query.filter(User.id.in_(panelist_ids)).all()
    if len(panelists) != len(panelist_ids):
        return jsonify({"error": "One or more panelist IDs were not found"}), 404

    invalid_panelists = [panelist.id for panelist in panelists if panelist.role != UserRole.PANELIST.value]
    if invalid_panelists:
        return jsonify({"errors": {"panelist_ids": [f"Users {invalid_panelists} are not PANELIST"]}}), 400

    # Fetch all recruiters assigned to this JD to include in Teams invite
    assigned_recruiter_ids = [
        a.recruiter_id for a in JDRecruiterAssignment.query.filter_by(jd_id=jd_id).all()
    ]
    assigned_recruiters = (
        User.query.filter(User.id.in_(assigned_recruiter_ids), User.is_active == True).all()
        if assigned_recruiter_ids else []
    )
    # Also include JD creator if not already in the assigned list
    if jd.created_by is not None:
        creator_ids = {r.id for r in assigned_recruiters}
        if jd.created_by not in creator_ids:
            creator = db.session.get(User, jd.created_by)
            if creator and creator.is_active:
                assigned_recruiters.append(creator)

    created_at = datetime.now(timezone.utc).replace(tzinfo=None)

    try:
        insert_interview_stmt = sa.text(
            """
            INSERT INTO interview_schedules
                (candidate_id, jd_id, scheduled_at, duration_minutes, mode, meeting_link, timezone, notes, status, created_at)
            VALUES
                (:candidate_id, :jd_id, :scheduled_at, :duration_minutes, :mode, :meeting_link, :timezone, :notes, :status, :created_at)
            """
        )
        interview_result = db.session.execute(
            insert_interview_stmt,
            {
                "candidate_id": candidate_id,
                "jd_id": jd_id,
                "scheduled_at": scheduled_at_utc,
                "duration_minutes": duration_minutes,
                "mode": mode,
                "meeting_link": None,
                "timezone": timezone_str,
                "notes": notes,
                "status": "SCHEDULED",
                "created_at": created_at,
            },
        )
        interview_id = interview_result.lastrowid

        assignment_stmt = sa.text(
            """
            INSERT INTO panel_assignments (interview_id, panelist_id, created_at)
            VALUES (:interview_id, :panelist_id, :created_at)
            """
        )
        for panelist_id in panelist_ids:
            db.session.execute(
                assignment_stmt,
                {
                    "interview_id": interview_id,
                    "panelist_id": panelist_id,
                    "created_at": created_at,
                },
            )

        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({"error": "Failed to create interview"}), 500

    try:
        seen_extra: set = set()
        extra_emails: List[str] = []
        extra_names: List[str] = []
        for r in assigned_recruiters:
            if r.email not in seen_extra:
                seen_extra.add(r.email)
                extra_emails.append(r.email)
                extra_names.append(r.full_name)
        for ae in additional_emails:
            if ae not in seen_extra:
                seen_extra.add(ae)
                extra_emails.append(ae)
                extra_names.append("")
        meeting = create_teams_interview_event(
            subject=f"Interview: {jd.title} - {candidate.email}",
            start_utc=scheduled_at_utc,
            duration_minutes=duration_minutes,
            candidate_email=candidate.email,
            candidate_name=candidate.full_name,
            panelist_emails=[panelist.email for panelist in panelists],
            panelist_names=[panelist.full_name for panelist in panelists],
            notes=notes,
            extra_attendee_emails=extra_emails,
            extra_attendee_names=extra_names,
        )
        db.session.execute(
            sa.text(
                """
                UPDATE interview_schedules
                SET meeting_link = :join_url,
                    external_event_id = :external_event_id,
                    teams_meeting_id = :teams_meeting_id
                WHERE id = :interview_id
                """
            ),
            {
                "join_url": meeting["join_url"],
                "external_event_id": meeting["external_event_id"],
                "teams_meeting_id": meeting.get("teams_meeting_id"),
                "interview_id": interview_id,
            },
        )
        db.session.commit()
    except RuntimeError as teams_err:
        db.session.rollback()
        try:
            delete_assignments_stmt = sa.text("DELETE FROM panel_assignments WHERE interview_id = :interview_id")
            delete_interview_stmt = sa.text("DELETE FROM interview_schedules WHERE id = :interview_id")
            db.session.execute(delete_assignments_stmt, {"interview_id": interview_id})
            db.session.execute(delete_interview_stmt, {"interview_id": interview_id})
            db.session.commit()
        except Exception:
            db.session.rollback()
        return jsonify({"error": f"Failed to create Teams meeting: {str(teams_err)}"}), 503

    interview, error = _get_interview_by_id(interview_id, UserRole.ADMIN.value, user)
    if error:
        return error

    # Email failures are logged by the service and intentionally do not break scheduling.
    send_interview_scheduled_to_candidate(
        candidate, interview, jd,
        jd_skills=jd_skills_for_email,
        client_name=client_name_for_email,
    )
    for panelist in panelists:
        send_interview_scheduled_to_panelist(panelist, candidate, interview, jd)
    for recruiter in assigned_recruiters:
        send_interview_scheduled_to_recruiter(recruiter, candidate, interview, jd)
    for email in additional_emails:
        send_interview_notification_to_additional_recipient(email, candidate, interview, jd)

    return jsonify({"interview": interview}), 201


@interviews_bp.get("")
@jwt_required()
def list_interviews():
    role = get_jwt().get("role")
    if role not in LIST_ALLOWED_ROLES:
        return jsonify({"message": "Forbidden"}), 403

    user = _get_current_user()
    if user is None:
        return jsonify({"message": "User not found"}), 404

    filters, params, error = _build_interview_filters(role, user)
    if error:
        return error

    sql = _base_interview_query_sql()
    if filters:
        sql += " WHERE " + " AND ".join(filters)
    sql += " ORDER BY s.scheduled_at DESC"

    rows = db.session.execute(sa.text(sql), params).mappings().all()
    interviews = _serialize_interview_rows(rows)

    return jsonify({"interviews": interviews}), 200


@interviews_bp.get("/<int:interview_id>")
@jwt_required()
def get_interview(interview_id: int):
    role = get_jwt().get("role")
    if role not in LIST_ALLOWED_ROLES:
        return jsonify({"message": "Forbidden"}), 403

    user = _get_current_user()
    if user is None:
        return jsonify({"message": "User not found"}), 404

    interview, error = _get_interview_by_id(interview_id, role, user)
    if error:
        return error

    return jsonify({"interview": interview}), 200


@interviews_bp.put("/<int:interview_id>/status")
@jwt_required()
def update_interview_status(interview_id: int):
    role = get_jwt().get("role")
    if role not in STATUS_UPDATE_ROLES:
        return jsonify({"message": "Forbidden"}), 403

    user = _get_current_user()
    if user is None:
        return jsonify({"message": "User not found"}), 404

    payload = request.get_json(silent=True) or {}
    status = payload.get("status")
    if not isinstance(status, str):
        return jsonify({"errors": {"status": ["status is required"]}}), 400

    normalized_status = status.strip().upper()
    if normalized_status not in VALID_INTERVIEW_STATUS:
        return jsonify({"errors": {"status": ["Invalid status"]}}), 400

    update_stmt = sa.text(
        "UPDATE interview_schedules SET status = :status WHERE id = :interview_id"
    )
    result = db.session.execute(update_stmt, {"status": normalized_status, "interview_id": interview_id})
    if result.rowcount == 0:
        db.session.rollback()
        return jsonify({"error": "Interview not found"}), 404

    db.session.commit()

    if normalized_status == "CANCELLED":
        event_row = db.session.execute(
            sa.text(
                """
                SELECT external_event_id
                FROM interview_schedules
                WHERE id = :interview_id
                """
            ),
            {"interview_id": interview_id},
        ).mappings().first()
        if event_row and event_row["external_event_id"]:
            cancel_teams_interview_event(event_row["external_event_id"])

    interview, error = _get_interview_by_id(interview_id, role, user)
    if error:
        return error

    return jsonify({"interview": interview}), 200


@interviews_bp.post("/panelist-availability")
@jwt_required()
def create_panelist_availability():
    role = get_jwt().get("role")
    if role not in AVAILABILITY_WRITE_ROLES:
        return jsonify({"message": "Forbidden"}), 403

    user = _get_current_user()
    if user is None:
        return jsonify({"message": "User not found"}), 404

    payload = request.get_json(silent=True) or {}
    slots = payload.get("slots")

    if not isinstance(slots, list) or not slots:
        return jsonify({"errors": {"slots": ["slots must be a non-empty list"]}}), 400

    panelist_id = user.id
    if role == UserRole.ADMIN.value:
        requested_panelist_id = payload.get("panelist_id")
        if requested_panelist_id is not None:
            if not isinstance(requested_panelist_id, int) or requested_panelist_id <= 0:
                return jsonify({"errors": {"panelist_id": ["panelist_id must be a positive integer"]}}), 400
            panelist_id = requested_panelist_id

    panelist = db.session.get(User, panelist_id)
    if panelist is None or panelist.role != UserRole.PANELIST.value:
        return jsonify({"error": "Target user must have PANELIST role"}), 400

    created = 0
    created_at = datetime.now(timezone.utc).replace(tzinfo=None)

    for slot in slots:
        if not isinstance(slot, dict):
            continue

        available_date = _parse_date(slot.get("date"))
        start_time = _parse_hhmm(slot.get("start_time"))
        end_time = _parse_hhmm(slot.get("end_time"))

        if available_date is None or start_time is None or end_time is None:
            continue
        if end_time <= start_time:
            continue

        exists_stmt = sa.text(
            """
            SELECT id FROM panelist_availability
            WHERE panelist_id = :panelist_id
              AND available_date = :available_date
              AND start_time = :start_time
            LIMIT 1
            """
        )
        start_str = start_time.strftime("%H:%M:%S")
        end_str = end_time.strftime("%H:%M:%S")
        date_str = available_date.isoformat()

        exists = db.session.execute(
            exists_stmt,
            {
                "panelist_id": panelist_id,
                "available_date": date_str,
                "start_time": start_str,
            },
        ).first()
        if exists:
            continue

        insert_stmt = sa.text(
            """
            INSERT INTO panelist_availability
                (panelist_id, available_date, start_time, end_time, is_booked, created_at)
            VALUES
                (:panelist_id, :available_date, :start_time, :end_time, :is_booked, :created_at)
            """
        )
        db.session.execute(
            insert_stmt,
            {
                "panelist_id": panelist_id,
                "available_date": date_str,
                "start_time": start_str,
                "end_time": end_str,
                "is_booked": 0,
                "created_at": created_at,
            },
        )
        created += 1

    db.session.commit()
    return jsonify({"message": "Availability updated", "created": created}), 201


@interviews_bp.get("/panelist-availability")
@jwt_required()
def list_panelist_availability():
    role = get_jwt().get("role")
    if role not in LIST_ALLOWED_ROLES:
        return jsonify({"message": "Forbidden"}), 403

    user = _get_current_user()
    if user is None:
        return jsonify({"message": "User not found"}), 404

    date_from = request.args.get("date_from", type=str)
    date_to = request.args.get("date_to", type=str)
    panelist_id = request.args.get("panelist_id", type=int)

    filters = ["a.is_booked = 0"]
    params: Dict[str, Any] = {}

    if date_from:
        parsed_from = _parse_date(date_from)
        if parsed_from is None:
            return jsonify({"errors": {"date_from": ["Invalid date format"]}}), 400
        filters.append("a.available_date >= :date_from")
        params["date_from"] = parsed_from

    if date_to:
        parsed_to = _parse_date(date_to)
        if parsed_to is None:
            return jsonify({"errors": {"date_to": ["Invalid date format"]}}), 400
        filters.append("a.available_date <= :date_to")
        params["date_to"] = parsed_to

    if role == UserRole.PANELIST.value:
        filters.append("a.panelist_id = :panelist_id")
        params["panelist_id"] = user.id
    elif panelist_id is not None:
        if role != UserRole.ADMIN.value:
            return jsonify({"message": "Forbidden"}), 403
        filters.append("a.panelist_id = :panelist_id")
        params["panelist_id"] = panelist_id

    sql = """
        SELECT
            a.id,
            a.panelist_id,
            u.full_name AS panelist_name,
            a.available_date,
            a.start_time,
            a.end_time
        FROM panelist_availability a
        JOIN users u ON u.id = a.panelist_id
    """
    if filters:
        sql += " WHERE " + " AND ".join(filters)
    sql += " ORDER BY a.panelist_id, a.available_date, a.start_time"

    rows = db.session.execute(sa.text(sql), params).mappings().all()

    grouped: Dict[int, Dict[str, Any]] = {}
    for row in rows:
        panelist_payload = grouped.setdefault(
            row["panelist_id"],
            {
                "panelist_id": row["panelist_id"],
                "panelist_name": row["panelist_name"],
                "slots": [],
            },
        )
        panelist_payload["slots"].append(
            {
                "id": row["id"],
                "date": _iso_format(row["available_date"]),
                "start_time": _iso_format(row["start_time"]),
                "end_time": _iso_format(row["end_time"]),
            }
        )

    # For PANELIST role, return a flat list of slots directly to match frontend expectations
    if role == UserRole.PANELIST.value:
        all_slots = []
        for p in grouped.values():
            all_slots.extend(p["slots"])
        return jsonify(all_slots), 200

    return jsonify({"panelists": list(grouped.values())}), 200
