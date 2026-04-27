from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, List, Optional

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt, get_jwt_identity, jwt_required
import sqlalchemy as sa

from app.extensions import db
from app.models.candidate import Candidate
from app.models.job_description import JobDescription
from app.models.user import User, UserRole
from app.services.email_service import (
    send_interview_scheduled_to_candidate,
    send_interview_scheduled_to_panelist,
    send_interview_scheduled_to_recruiter,
)


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

VALID_MODES = {"virtual", "in_person"}


def _get_current_user() -> Optional[User]:
    user_id = get_jwt_identity()
    if user_id is None:
        return None
    return User.query.get(int(user_id))


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
                "scheduled_at": row["scheduled_at"].isoformat() if row["scheduled_at"] else None,
                "duration_minutes": row["duration_minutes"],
                "mode": row["mode"],
                "meeting_link": row["meeting_link"],
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
    duration_minutes = payload.get("duration_minutes", 60)
    mode = payload.get("mode")
    meeting_link = payload.get("meeting_link")
    panelist_ids = payload.get("panelist_ids")
    notes = payload.get("notes")

    if not isinstance(candidate_id, int) or candidate_id <= 0:
        return jsonify({"errors": {"candidate_id": ["candidate_id must be a positive integer"]}}), 400

    if not isinstance(jd_id, int) or jd_id <= 0:
        return jsonify({"errors": {"jd_id": ["jd_id must be a positive integer"]}}), 400

    scheduled_at = _parse_iso_datetime(scheduled_at_raw)
    if scheduled_at is None:
        return jsonify({"errors": {"scheduled_at": ["scheduled_at must be ISO datetime"]}}), 400

    if not isinstance(duration_minutes, int) or duration_minutes <= 0:
        return jsonify({"errors": {"duration_minutes": ["duration_minutes must be a positive integer"]}}), 400

    if mode not in VALID_MODES:
        return jsonify({"errors": {"mode": ["mode must be virtual or in_person"]}}), 400

    if not isinstance(panelist_ids, list) or not (1 <= len(panelist_ids) <= 3):
        return jsonify({"errors": {"panelist_ids": ["panelist_ids must contain 1 to 3 panelists"]}}), 400

    if any(not isinstance(panelist_id, int) or panelist_id <= 0 for panelist_id in panelist_ids):
        return jsonify({"errors": {"panelist_ids": ["panelist_ids must be positive integers"]}}), 400

    panelist_ids = list(dict.fromkeys(panelist_ids))
    if len(panelist_ids) > 3:
        return jsonify({"errors": {"panelist_ids": ["panelist_ids must contain 1 to 3 panelists"]}}), 400

    candidate = Candidate.query.get(candidate_id)
    if candidate is None:
        return jsonify({"error": "Candidate not found"}), 404

    jd = JobDescription.query.get(jd_id)
    if jd is None:
        return jsonify({"error": "JD not found"}), 404

    if candidate.jd_id != jd.id:
        return jsonify({"errors": {"jd_id": ["Candidate does not belong to this JD"]}}), 400

    if not _candidate_accessible_for_user(role, user, candidate):
        return jsonify({"message": "Forbidden"}), 403

    panelists = User.query.filter(User.id.in_(panelist_ids)).all()
    if len(panelists) != len(panelist_ids):
        return jsonify({"error": "One or more panelist IDs were not found"}), 404

    invalid_panelists = [panelist.id for panelist in panelists if panelist.role != UserRole.PANELIST.value]
    if invalid_panelists:
        return jsonify({"errors": {"panelist_ids": [f"Users {invalid_panelists} are not PANELIST"]}}), 400

    interview_end = scheduled_at + timedelta(minutes=duration_minutes)
    slot_date = scheduled_at.date()
    slot_start = scheduled_at.time().replace(microsecond=0)
    slot_end = interview_end.time().replace(microsecond=0)

    slot_ids_to_book: List[int] = []
    for panelist_id in panelist_ids:
        slot_stmt = sa.text(
            """
            SELECT id
            FROM panelist_availability
            WHERE panelist_id = :panelist_id
              AND available_date = :available_date
              AND start_time <= :start_time
              AND end_time >= :end_time
              AND is_booked = 0
            ORDER BY start_time
            LIMIT 1
            """
        )
        slot_row = db.session.execute(
            slot_stmt,
            {
                "panelist_id": panelist_id,
                "available_date": slot_date,
                "start_time": slot_start,
                "end_time": slot_end,
            },
        ).mappings().first()

        if slot_row is None:
            return jsonify({"error": f"Panelist {panelist_id} is not available for the selected slot"}), 409

        slot_ids_to_book.append(slot_row["id"])

    created_at = datetime.now(timezone.utc).replace(tzinfo=None)

    try:
        insert_interview_stmt = sa.text(
            """
            INSERT INTO interview_schedules
                (candidate_id, jd_id, scheduled_at, duration_minutes, mode, meeting_link, notes, status, created_at)
            VALUES
                (:candidate_id, :jd_id, :scheduled_at, :duration_minutes, :mode, :meeting_link, :notes, :status, :created_at)
            """
        )
        interview_result = db.session.execute(
            insert_interview_stmt,
            {
                "candidate_id": candidate_id,
                "jd_id": jd_id,
                "scheduled_at": scheduled_at,
                "duration_minutes": duration_minutes,
                "mode": mode,
                "meeting_link": meeting_link,
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

        update_availability_stmt = sa.text(
            "UPDATE panelist_availability SET is_booked = 1 WHERE id IN :slot_ids"
        ).bindparams(sa.bindparam("slot_ids", expanding=True))
        db.session.execute(update_availability_stmt, {"slot_ids": slot_ids_to_book})

        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({"error": "Failed to create interview"}), 500

    interview, error = _get_interview_by_id(interview_id, UserRole.ADMIN.value, user)
    if error:
        return error

    recruiter = User.query.get(jd.created_by) if jd.created_by is not None else None

    # Email failures are logged by the service and intentionally do not break scheduling.
    send_interview_scheduled_to_candidate(candidate, interview, jd)
    for panelist in panelists:
        send_interview_scheduled_to_panelist(panelist, candidate, interview, jd)
    if recruiter is not None:
        send_interview_scheduled_to_recruiter(recruiter, candidate, interview, jd)

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

    panelist = User.query.get(panelist_id)
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
        exists = db.session.execute(
            exists_stmt,
            {
                "panelist_id": panelist_id,
                "available_date": available_date,
                "start_time": start_time,
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
                "available_date": available_date,
                "start_time": start_time,
                "end_time": end_time,
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
