from typing import Optional

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt, get_jwt_identity, jwt_required
from marshmallow import ValidationError
from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.models.candidate import Candidate, CANDIDATE_STATUSES
from app.models.client import Client
from app.models.job_description import JobDescription
from app.models.user import User, UserRole
from app.schemas.candidate_schema import candidate_schema, candidates_schema, candidate_update_schema


candidates_bp = Blueprint("candidates", __name__, url_prefix="/api/candidates")

ALLOWED_ROLES = {
    UserRole.RECRUITER.value,
    UserRole.SR_RECRUITER.value,
    UserRole.M_RECRUITER.value,
    UserRole.QC.value,
    UserRole.ADMIN.value,
}


def _get_current_user() -> Optional[User]:
    user_id = get_jwt_identity()
    if user_id is None:
        return None
    return User.query.get(int(user_id))


def _can_access_client(role: str, user: Optional[User], client_id: int) -> bool:
    if role in {UserRole.ADMIN.value, UserRole.M_RECRUITER.value, UserRole.SR_RECRUITER.value, UserRole.QC.value}:
        return True

    return role == UserRole.RECRUITER.value and user is not None and user.client_id == client_id


@candidates_bp.get("")
@jwt_required()
def list_candidates():
    role = get_jwt().get("role")
    if role not in ALLOWED_ROLES:
        return jsonify({"message": "Forbidden"}), 403

    user = _get_current_user()
    if user is None:
        return jsonify({"message": "User not found"}), 404

    query = Candidate.query

    client_id = request.args.get("client_id", type=int)
    jd_id = request.args.get("jd_id", type=int)
    status = request.args.get("status", type=str)

    if role == UserRole.RECRUITER.value:
        if user.client_id is None:
            return jsonify({"candidates": []}), 200
        query = query.filter(Candidate.client_id == user.client_id)

    if client_id is not None:
        if not _can_access_client(role, user, client_id):
            return jsonify({"message": "Forbidden"}), 403
        query = query.filter(Candidate.client_id == client_id)

    if jd_id is not None:
        query = query.filter(Candidate.jd_id == jd_id)

    if status:
        normalized_status = status.strip().upper()
        if normalized_status not in CANDIDATE_STATUSES:
            return jsonify({"errors": {"status": [f"Must be one of: {', '.join(CANDIDATE_STATUSES)}"]}}), 400
        query = query.filter(Candidate.status == normalized_status)

    candidates = query.order_by(Candidate.created_at.desc()).all()
    return jsonify({"candidates": candidates_schema.dump(candidates)}), 200


@candidates_bp.post("")
@jwt_required()
def create_candidate():
    role = get_jwt().get("role")
    if role not in ALLOWED_ROLES:
        return jsonify({"message": "Forbidden"}), 403

    user = _get_current_user()
    if user is None:
        return jsonify({"message": "User not found"}), 404

    payload = request.get_json(silent=True) or {}
    try:
        validated = candidate_schema.load(payload)
    except ValidationError as err:
        return jsonify({"errors": err.messages}), 400

    client_id = validated["client_id"]
    jd_id = validated["jd_id"]

    if not _can_access_client(role, user, client_id):
        return jsonify({"message": "Forbidden"}), 403

    client = Client.query.get(client_id)
    if client is None:
        return jsonify({"error": "Client not found"}), 404

    jd = JobDescription.query.get(jd_id)
    if jd is None:
        return jsonify({"error": "JD not found"}), 404

    if jd.client_id != client_id:
        return jsonify({"errors": {"jd_id": ["JD does not belong to this client."]}}), 400

    candidate = Candidate(
        client_id=client_id,
        jd_id=jd_id,
        full_name=validated["full_name"].strip(),
        email=validated["email"].strip().lower(),
        status=validated.get("status", "APPLIED"),
    )
    db.session.add(candidate)

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "Candidate already exists for this JD"}), 409

    return jsonify({"candidate": candidate_schema.dump(candidate)}), 201


@candidates_bp.put("/<int:candidate_id>")
@jwt_required()
def update_candidate(candidate_id):
    role = get_jwt().get("role")
    if role not in ALLOWED_ROLES:
        return jsonify({"message": "Forbidden"}), 403

    user = _get_current_user()
    if user is None:
        return jsonify({"message": "User not found"}), 404

    candidate = Candidate.query.get(candidate_id)
    if candidate is None:
        return jsonify({"error": "Candidate not found"}), 404

    if not _can_access_client(role, user, candidate.client_id):
        return jsonify({"message": "Forbidden"}), 403

    payload = request.get_json(silent=True) or {}
    try:
        validated = candidate_update_schema.load(payload)
    except ValidationError as err:
        return jsonify({"errors": err.messages}), 400

    if "jd_id" in validated:
        jd = JobDescription.query.get(validated["jd_id"])
        if jd is None:
            return jsonify({"error": "JD not found"}), 404
        if jd.client_id != candidate.client_id:
            return jsonify({"errors": {"jd_id": ["JD does not belong to candidate client."]}}), 400
        candidate.jd_id = jd.id

    if "full_name" in validated:
        candidate.full_name = validated["full_name"].strip()

    if "email" in validated:
        candidate.email = validated["email"].strip().lower()

    if "status" in validated:
        candidate.status = validated["status"]

    db.session.commit()
    return jsonify({"candidate": candidate_schema.dump(candidate)}), 200


@candidates_bp.delete("/<int:candidate_id>")
@jwt_required()
def delete_candidate(candidate_id):
    role = get_jwt().get("role")
    if role not in {UserRole.ADMIN.value, UserRole.M_RECRUITER.value, UserRole.SR_RECRUITER.value}:
        return jsonify({"message": "Forbidden"}), 403

    user = _get_current_user()
    if user is None:
        return jsonify({"message": "User not found"}), 404

    candidate = Candidate.query.get(candidate_id)
    if candidate is None:
        return jsonify({"error": "Candidate not found"}), 404

    db.session.delete(candidate)
    db.session.commit()
    return jsonify({"message": "Candidate deleted successfully"}), 200
