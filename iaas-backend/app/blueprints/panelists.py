from __future__ import annotations

import logging
from datetime import datetime, timezone
from io import BytesIO
from typing import Any, Dict, List, Optional

import openpyxl
import sqlalchemy as sa
from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt, get_jwt_identity, jwt_required

from app.extensions import db, limiter
from app.models.panelist import Panelist
from app.models.user import User, UserRole

logger = logging.getLogger(__name__)

panelists_bp = Blueprint("panelists", __name__)

_ADMIN_ONLY = {UserRole.ADMIN.value}
_MAX_UPLOAD_BYTES = 100 * 1024 * 1024  # 100 MB — accommodates large panelist sheets
_EXCEL_REQUIRED_COLS = {"Name", "Email ID"}


def _get_current_user() -> Optional[User]:
    uid = get_jwt_identity()
    return db.session.get(User, int(uid)) if uid else None


def _normalize(val: Any) -> str:
    return str(val or "").strip()


def _generate_panel_id(panelist_id: int) -> str:
    return f"PAN-{panelist_id:04d}"


def _build_row(p: Panelist) -> Dict[str, Any]:
    return {
        "id": p.id,
        "panel_id": p.panel_id,
        "name": p.name,
        "skill": p.skill or "",
        "email": p.email,
        "phone": p.phone or "",
        "location": p.location or "",
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


def _validate_panelist_fields(name: str, email: str, errors: dict) -> None:
    if not name:
        errors["name"] = ["Name is required"]
    if not email:
        errors["email"] = ["Email is required"]
    elif "@" not in email or "." not in email.split("@")[-1]:
        errors["email"] = ["Invalid email address"]


def _email_taken(email: str, exclude_id: Optional[int] = None) -> bool:
    q = Panelist.query.filter(sa.func.lower(Panelist.email) == email.lower())
    if exclude_id:
        q = q.filter(Panelist.id != exclude_id)
    return q.first() is not None


def _save_panelist(name: str, skill: str, email: str, phone: str, location: str, created_by_id: int) -> Panelist:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    p = Panelist(
        panel_id="TMP",
        name=name,
        skill=skill or None,
        email=email.lower(),
        phone=phone or None,
        location=location or None,
        created_at=now,
        created_by=created_by_id,
    )
    db.session.add(p)
    db.session.flush()  # get p.id
    p.panel_id = _generate_panel_id(p.id)
    db.session.commit()
    return p


# ── List ──────────────────────────────────────────────────────────────────────

@panelists_bp.get("")
@jwt_required()
def list_panelists():
    role = get_jwt().get("role")
    if role not in _ADMIN_ONLY:
        # Non-admin roles (OPERATOR, M_RECRUITER etc.) can read for scheduling
        allowed_read = {
            UserRole.ADMIN.value,
            UserRole.OPERATOR.value,
            UserRole.M_RECRUITER.value,
            UserRole.SR_RECRUITER.value,
        }
        if role not in allowed_read:
            return jsonify({"message": "Forbidden"}), 403

    search = request.args.get("search", "").strip().lower()
    query = Panelist.query.order_by(Panelist.panel_id)
    if search:
        like = f"%{search}%"
        query = query.filter(
            sa.or_(
                Panelist.name.ilike(like),
                Panelist.email.ilike(like),
                Panelist.skill.ilike(like),
                Panelist.location.ilike(like),
            )
        )

    panelists = query.all()
    return jsonify({"panelists": [_build_row(p) for p in panelists]}), 200


# ── Create single ─────────────────────────────────────────────────────────────

@panelists_bp.post("")
@jwt_required()
@limiter.limit("60 per hour")
def create_panelist():
    role = get_jwt().get("role")
    if role not in _ADMIN_ONLY:
        return jsonify({"message": "Forbidden"}), 403

    user = _get_current_user()
    if user is None:
        return jsonify({"message": "User not found"}), 404

    payload = request.get_json(silent=True) or {}
    name = _normalize(payload.get("name"))
    skill = _normalize(payload.get("skill"))
    email = _normalize(payload.get("email"))
    phone = _normalize(payload.get("phone"))
    location = _normalize(payload.get("location"))

    errors: dict = {}
    _validate_panelist_fields(name, email, errors)
    if errors:
        return jsonify({"errors": errors}), 400

    if _email_taken(email):
        return jsonify({"errors": {"email": ["A panelist with this email already exists"]}}), 409

    p = _save_panelist(name, skill, email, phone, location, user.id)
    return jsonify({"panelist": _build_row(p)}), 201


# ── Bulk create (JSON array of panelists) ─────────────────────────────────────

@panelists_bp.post("/bulk")
@jwt_required()
@limiter.limit("20 per hour")
def create_bulk_panelists():
    role = get_jwt().get("role")
    if role not in _ADMIN_ONLY:
        return jsonify({"message": "Forbidden"}), 403

    user = _get_current_user()
    if user is None:
        return jsonify({"message": "User not found"}), 404

    payload = request.get_json(silent=True) or {}
    entries = payload.get("panelists")
    if not isinstance(entries, list) or len(entries) == 0:
        return jsonify({"errors": {"panelists": ["Must be a non-empty array"]}}), 400
    if len(entries) > 100:
        return jsonify({"errors": {"panelists": ["Maximum 100 panelists per request"]}}), 400

    results: List[Dict] = []
    success_count = 0

    for i, entry in enumerate(entries, start=1):
        if not isinstance(entry, dict):
            results.append({"row": i, "status": "error", "reason": "Entry must be an object"})
            continue

        name = _normalize(entry.get("name"))
        skill = _normalize(entry.get("skill"))
        email = _normalize(entry.get("email"))
        phone = _normalize(entry.get("phone"))
        location = _normalize(entry.get("location"))

        field_errors: dict = {}
        _validate_panelist_fields(name, email, field_errors)
        if field_errors:
            results.append({"row": i, "status": "error", "email": email, "reason": "; ".join(
                f"{k}: {v[0]}" for k, v in field_errors.items()
            )})
            continue

        if _email_taken(email):
            results.append({"row": i, "status": "error", "email": email, "reason": f"Email {email} already exists"})
            continue

        try:
            p = _save_panelist(name, skill, email, phone, location, user.id)
            results.append({"row": i, "status": "success", "panel_id": p.panel_id, "email": email})
            success_count += 1
        except Exception as exc:
            db.session.rollback()
            logger.exception("Bulk panelist row %d failed", i)
            results.append({"row": i, "status": "error", "email": email, "reason": "Internal error saving row"})

    return jsonify({"total": len(entries), "success": success_count, "results": results}), 200


# ── Excel upload ──────────────────────────────────────────────────────────────

@panelists_bp.post("/excel-upload")
@jwt_required()
@limiter.limit("10 per hour")
def excel_upload_panelists():
    role = get_jwt().get("role")
    if role not in _ADMIN_ONLY:
        return jsonify({"message": "Forbidden"}), 403

    user = _get_current_user()
    if user is None:
        return jsonify({"message": "User not found"}), 404

    upload = request.files.get("file")
    if not upload or not upload.filename:
        return jsonify({"errors": {"file": ["File is required"]}}), 400

    file_bytes = upload.read()
    if not file_bytes:
        return jsonify({"errors": {"file": ["File is empty"]}}), 400
    if len(file_bytes) > _MAX_UPLOAD_BYTES:
        return jsonify({"errors": {"file": ["File exceeds the 100 MB limit"]}}), 400

    ext = upload.filename.rsplit(".", 1)[-1].lower() if "." in upload.filename else ""
    if ext not in {"xlsx", "xls"}:
        return jsonify({"errors": {"file": ["Only .xlsx / .xls files are supported"]}}), 400

    try:
        wb = openpyxl.load_workbook(BytesIO(file_bytes), read_only=True, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
    except Exception:
        return jsonify({"errors": {"file": ["Could not read Excel file"]}}), 400

    if not rows:
        return jsonify({"errors": {"file": ["Excel file has no rows"]}}), 400

    headers = [_normalize(h) for h in rows[0]]

    # Map expected display column names to internal keys
    col_map = {
        "name": None,
        "skill": None,
        "email id": None,
        "number": None,
        "location": None,
    }
    for idx, h in enumerate(headers):
        lower = h.lower()
        if lower in col_map:
            col_map[lower] = idx

    missing = [k for k in _EXCEL_REQUIRED_COLS if col_map.get(k.lower()) is None]
    if missing:
        return jsonify({"errors": {"file": [f"Missing required column(s): {', '.join(missing)}"]}}), 400

    results: List[Dict] = []
    success_count = 0

    for row_num, row_vals in enumerate(rows[1:], start=2):
        def cell(key: str) -> str:
            idx = col_map.get(key)
            return _normalize(row_vals[idx]) if idx is not None and idx < len(row_vals) else ""

        name = cell("name")
        skill = cell("skill")
        email = cell("email id")
        phone = cell("number")
        location = cell("location")

        if not name and not email:
            continue  # skip blank rows silently

        field_errors: dict = {}
        _validate_panelist_fields(name, email, field_errors)
        if field_errors:
            results.append({"row": row_num, "status": "error", "email": email, "reason": "; ".join(
                f"{k}: {v[0]}" for k, v in field_errors.items()
            )})
            continue

        if _email_taken(email):
            results.append({"row": row_num, "status": "error", "email": email, "reason": f"Email {email} already exists"})
            continue

        try:
            p = _save_panelist(name, skill, email, phone, location, user.id)
            results.append({"row": row_num, "status": "success", "panel_id": p.panel_id, "name": name, "email": email})
            success_count += 1
        except Exception:
            db.session.rollback()
            logger.exception("Excel upload row %d failed", row_num)
            results.append({"row": row_num, "status": "error", "email": email, "reason": "Internal error saving row"})

    return jsonify({
        "total": len(rows) - 1,
        "success": success_count,
        "errors": len(results) - success_count,
        "results": results,
    }), 200


# ── Update ────────────────────────────────────────────────────────────────────

@panelists_bp.put("/<int:panelist_id>")
@jwt_required()
def update_panelist(panelist_id: int):
    role = get_jwt().get("role")
    if role not in _ADMIN_ONLY:
        return jsonify({"message": "Forbidden"}), 403

    p = db.session.get(Panelist, panelist_id)
    if p is None:
        return jsonify({"error": "Panelist not found"}), 404

    payload = request.get_json(silent=True) or {}
    name = _normalize(payload.get("name", p.name))
    skill = _normalize(payload.get("skill", p.skill or ""))
    email = _normalize(payload.get("email", p.email))
    phone = _normalize(payload.get("phone", p.phone or ""))
    location = _normalize(payload.get("location", p.location or ""))

    errors: dict = {}
    _validate_panelist_fields(name, email, errors)
    if errors:
        return jsonify({"errors": errors}), 400

    if _email_taken(email, exclude_id=panelist_id):
        return jsonify({"errors": {"email": ["A panelist with this email already exists"]}}), 409

    p.name = name
    p.skill = skill or None
    p.email = email.lower()
    p.phone = phone or None
    p.location = location or None
    db.session.commit()

    return jsonify({"panelist": _build_row(p)}), 200


# ── Delete ────────────────────────────────────────────────────────────────────

@panelists_bp.delete("/<int:panelist_id>")
@jwt_required()
def delete_panelist(panelist_id: int):
    role = get_jwt().get("role")
    if role not in _ADMIN_ONLY:
        return jsonify({"message": "Forbidden"}), 403

    p = db.session.get(Panelist, panelist_id)
    if p is None:
        return jsonify({"error": "Panelist not found"}), 404

    try:
        db.session.delete(p)
        db.session.commit()
    except Exception:
        db.session.rollback()
        logger.exception("Failed to delete panelist %d", panelist_id)
        return jsonify({"error": "Cannot delete panelist — they may be assigned to active interviews"}), 409

    return jsonify({"message": "Panelist deleted"}), 200
