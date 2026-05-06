from __future__ import annotations

import csv
from datetime import datetime, timezone
from io import BytesIO, StringIO
from typing import Any, Dict, List, Optional

import openpyxl
import sqlalchemy as sa
from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt, get_jwt_identity, jwt_required

from app.extensions import db
from app.models.client import Client
from app.models.jd_panelist_assignment import JDPanelistAssignment
from app.models.job_description import JobDescription
from app.models.user import User, UserRole


panelist_assignments_bp = Blueprint("panelist_assignments", __name__)

ALLOWED_ROLES = {
    UserRole.ADMIN.value,
    UserRole.M_RECRUITER.value,
    UserRole.SR_RECRUITER.value,
    UserRole.OPERATOR.value,
}
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
REQUIRED_COLUMNS = {"panelist_email", "jd_code", "client_name"}


def _get_current_user() -> Optional[User]:
    user_id = get_jwt_identity()
    if user_id is None:
        return None
    return db.session.get(User, int(user_id))


def _normalize_text(value: Any) -> str:
    return str(value or "").strip()


def _ensure_access_to_client(role: str, current_user: User, client_id: Optional[int]):
    if role in {UserRole.ADMIN.value, UserRole.OPERATOR.value}:
        return None
    if client_id is not None and current_user.client_id != client_id:
        return jsonify({"message": "Forbidden"}), 403
    return None


def _serialize_assignment_row(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "jd_id": row["jd_id"],
        "panelist_id": row["panelist_id"],
        "client_id": row["client_id"],
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        "panelist_name": row["panelist_name"],
        "panelist_email": row["panelist_email"],
        "jd_title": row["jd_title"],
        "job_code": row["job_code"],
    }


def _load_assignment_rows(client_id: Optional[int] = None, jd_id: Optional[int] = None) -> List[Dict[str, Any]]:
    filters = ["1=1"]
    params: Dict[str, Any] = {}

    if client_id is not None:
        filters.append("pa.client_id = :client_id")
        params["client_id"] = client_id

    if jd_id is not None:
        filters.append("pa.jd_id = :jd_id")
        params["jd_id"] = jd_id

    rows = db.session.execute(
        sa.text(
            f"""
            SELECT
                pa.id,
                pa.jd_id,
                pa.panelist_id,
                pa.client_id,
                pa.created_at,
                u.full_name AS panelist_name,
                u.email AS panelist_email,
                j.title AS jd_title,
                j.job_code
            FROM jd_panelist_assignments pa
            JOIN users u ON u.id = pa.panelist_id
            JOIN job_descriptions j ON j.id = pa.jd_id
            WHERE {' AND '.join(filters)}
            ORDER BY j.title, u.full_name
            """
        ),
        params,
    ).mappings().all()
    return [_serialize_assignment_row(row) for row in rows]


def _read_import_rows(upload) -> List[Dict[str, str]]:
    file_name = _normalize_text(getattr(upload, "filename", ""))
    ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
    file_bytes = upload.read()
    if not file_bytes:
        raise ValueError("Uploaded file is empty")
    if len(file_bytes) > MAX_UPLOAD_BYTES:
        raise ValueError("File size must be 5MB or less")

    if ext == "csv":
        decoded = file_bytes.decode("utf-8-sig")
        reader = csv.DictReader(StringIO(decoded))
        return [{key: _normalize_text(value) for key, value in row.items()} for row in reader]

    if ext == "xlsx":
        workbook = openpyxl.load_workbook(BytesIO(file_bytes), read_only=True, data_only=True)
        worksheet = workbook.active
        rows = list(worksheet.iter_rows(values_only=True))
        if not rows:
            return []
        headers = [_normalize_text(value) for value in rows[0]]
        parsed_rows = []
        for values in rows[1:]:
            parsed_rows.append(
                {
                    headers[index]: _normalize_text(value)
                    for index, value in enumerate(values)
                    if index < len(headers) and headers[index]
                }
            )
        return parsed_rows

    raise ValueError("Only .xlsx and .csv files are supported")


@panelist_assignments_bp.get("")
@jwt_required()
def list_panelist_assignments():
    role = get_jwt().get("role")
    if role not in ALLOWED_ROLES:
        return jsonify({"message": "Forbidden"}), 403

    current_user = _get_current_user()
    if current_user is None:
        return jsonify({"message": "User not found"}), 404

    client_id = request.args.get("client_id", type=int)
    jd_id = request.args.get("jd_id", type=int)

    error = _ensure_access_to_client(role, current_user, client_id)
    if error:
        return error

    effective_client_id = client_id if role in {UserRole.ADMIN.value, UserRole.OPERATOR.value} else current_user.client_id
    assignments = _load_assignment_rows(effective_client_id, jd_id)
    return jsonify({"assignments": assignments}), 200


@panelist_assignments_bp.post("")
@jwt_required()
def create_panelist_assignment():
    role = get_jwt().get("role")
    if role not in ALLOWED_ROLES:
        return jsonify({"message": "Forbidden"}), 403

    current_user = _get_current_user()
    if current_user is None:
        return jsonify({"message": "User not found"}), 404

    payload = request.get_json(silent=True) or {}
    jd_id = payload.get("jd_id")
    panelist_id = payload.get("panelist_id")
    client_id = payload.get("client_id")

    if not isinstance(jd_id, int) or jd_id <= 0:
        return jsonify({"errors": {"jd_id": ["jd_id must be a positive integer"]}}), 400
    if not isinstance(panelist_id, int) or panelist_id <= 0:
        return jsonify({"errors": {"panelist_id": ["panelist_id must be a positive integer"]}}), 400
    if not isinstance(client_id, int) or client_id <= 0:
        return jsonify({"errors": {"client_id": ["client_id must be a positive integer"]}}), 400

    error = _ensure_access_to_client(role, current_user, client_id)
    if error:
        return error

    jd = db.session.get(JobDescription, jd_id)
    if jd is None:
        return jsonify({"error": "JD not found"}), 404
    if jd.client_id != client_id:
        return jsonify({"errors": {"client_id": ["JD does not belong to the specified client"]}}), 400

    panelist = db.session.get(User, panelist_id)
    if panelist is None or panelist.role != UserRole.PANELIST.value:
        return jsonify({"errors": {"panelist_id": ["User must exist and have PANELIST role"]}}), 400

    existing = JDPanelistAssignment.query.filter_by(jd_id=jd_id, panelist_id=panelist_id).first()
    if existing is None:
        assignment = JDPanelistAssignment(
            jd_id=jd_id,
            panelist_id=panelist_id,
            client_id=client_id,
            assigned_by=current_user.id,
        )
        db.session.add(assignment)
        db.session.commit()
        assignment_id = assignment.id
    else:
        assignment_id = existing.id

    assignment = _load_assignment_rows(client_id, jd_id)
    created_assignment = next((row for row in assignment if row["id"] == assignment_id), None)
    return jsonify({"assignment": created_assignment}), 201


@panelist_assignments_bp.delete("/<int:assignment_id>")
@jwt_required()
def delete_panelist_assignment(assignment_id: int):
    role = get_jwt().get("role")
    if role not in ALLOWED_ROLES:
        return jsonify({"message": "Forbidden"}), 403

    current_user = _get_current_user()
    if current_user is None:
        return jsonify({"message": "User not found"}), 404

    assignment = db.session.get(JDPanelistAssignment, assignment_id)
    if assignment is None:
        return jsonify({"error": "Assignment not found"}), 404

    error = _ensure_access_to_client(role, current_user, assignment.client_id)
    if error:
        return error

    db.session.delete(assignment)
    db.session.commit()
    return jsonify({"message": "Assignment removed"}), 200


@panelist_assignments_bp.post("/import")
@jwt_required()
def import_panelist_assignments():
    role = get_jwt().get("role")
    if role not in ALLOWED_ROLES:
        return jsonify({"message": "Forbidden"}), 403

    current_user = _get_current_user()
    if current_user is None:
        return jsonify({"message": "User not found"}), 404

    upload = request.files.get("file")
    if upload is None or not upload.filename:
        return jsonify({"errors": {"file": ["File is required"]}}), 400

    try:
        rows = _read_import_rows(upload)
    except ValueError as exc:
        return jsonify({"errors": {"file": [str(exc)]}}), 400

    if not rows:
        return jsonify({"errors": {"file": ["No rows found in uploaded file"]}}), 400

    missing_columns = REQUIRED_COLUMNS - set(rows[0].keys())
    if missing_columns:
        return jsonify({"errors": {"file": [f"Missing required columns: {', '.join(sorted(missing_columns))}"]}}), 400

    results = []
    success_count = 0

    for index, row in enumerate(rows, start=2):
        email = row.get("panelist_email", "").lower()
        jd_code = row.get("jd_code", "")
        client_name = row.get("client_name", "")

        panelist = User.query.filter(sa.func.lower(User.email) == email).first()
        if panelist is None or panelist.role != UserRole.PANELIST.value:
            results.append({"row": index, "status": "error", "reason": "Panelist not found or not PANELIST role"})
            continue

        jd = JobDescription.query.filter_by(job_code=jd_code).first()
        if jd is None:
            results.append({"row": index, "status": "error", "reason": f"JD code {jd_code} not found"})
            continue

        client = Client.query.filter(sa.func.lower(Client.name) == client_name.lower()).first()
        if client is None:
            results.append({"row": index, "status": "error", "reason": f"Client {client_name} not found"})
            continue

        error = _ensure_access_to_client(role, current_user, client.id)
        if error:
            results.append({"row": index, "status": "error", "reason": "Forbidden for this client"})
            continue

        if jd.client_id != client.id:
            results.append({"row": index, "status": "error", "reason": "JD does not belong to this client"})
            continue

        existing = JDPanelistAssignment.query.filter_by(jd_id=jd.id, panelist_id=panelist.id).first()
        if existing is None:
            db.session.add(
                JDPanelistAssignment(
                    jd_id=jd.id,
                    panelist_id=panelist.id,
                    client_id=client.id,
                    assigned_by=current_user.id,
                    created_at=datetime.now(timezone.utc),
                )
            )

        success_count += 1
        results.append({"row": index, "status": "success", "panelist": email, "jd": jd_code})

    db.session.commit()
    return jsonify({"total": len(rows), "success": success_count, "errors": len(rows) - success_count, "results": results}), 200
