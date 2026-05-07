from typing import Optional

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt, get_jwt_identity, jwt_required
from marshmallow import ValidationError
from sqlalchemy import case, func
from sqlalchemy.exc import ProgrammingError

from app.extensions import db
from app.models.candidate import Candidate
from app.models.client import Client
from app.models.job_description import JobDescription
from app.models.operator_client_assignment import OperatorClientAssignment
from app.models.user import User, UserRole
from app.schemas.client_schema import client_schema, clients_schema


clients_bp = Blueprint("clients", __name__)


def _get_current_user() -> Optional[User]:
    user_id = get_jwt_identity()
    if user_id is None:
        return None
    return db.session.get(User, int(user_id))


def _can_access_client(role: Optional[str], user: Optional[User], client: Client) -> bool:
    if role in {UserRole.ADMIN.value, UserRole.M_RECRUITER.value}:
        return True

    if role == UserRole.RECRUITER.value and user is not None:
        return user.client_id == client.id

    if role == UserRole.OPERATOR.value and user is not None:
        return OperatorClientAssignment.query.filter_by(
            operator_id=user.id, client_id=client.id
        ).first() is not None

    return False


def _build_metrics_map(client_ids):
    if not client_ids:
        return {}

    jd_counts_query = (
        db.session.query(JobDescription.client_id, func.count(JobDescription.id))
        .filter(JobDescription.client_id.in_(client_ids))
        .group_by(JobDescription.client_id)
        .all()
    )
    jd_counts = {client_id: count for client_id, count in jd_counts_query}

    try:
        candidate_counts_query = (
            db.session.query(
                Candidate.client_id,
                func.count(Candidate.id),
                func.sum(case((Candidate.status == "SELECTED", 1), else_=0)),
                func.sum(case((Candidate.status == "NOT_SELECTED", 1), else_=0)),
            )
            .filter(Candidate.client_id.in_(client_ids))
            .group_by(Candidate.client_id)
            .all()
        )
    except ProgrammingError:
        # Allows clients endpoints to work before candidates migration is applied.
        db.session.rollback()
        candidate_counts_query = []

    candidate_counts = {
        client_id: {
            "candidate_count": total or 0,
            "selected_count": selected or 0,
            "not_selected_count": not_selected or 0,
        }
        for client_id, total, selected, not_selected in candidate_counts_query
    }

    metrics = {}
    for client_id in client_ids:
        candidate_data = candidate_counts.get(client_id, {})
        metrics[client_id] = {
            "jd_count": jd_counts.get(client_id, 0),
            "candidate_count": candidate_data.get("candidate_count", 0),
            "selected_count": candidate_data.get("selected_count", 0),
            "not_selected_count": candidate_data.get("not_selected_count", 0),
        }
    return metrics


def _enrich_clients_with_metrics(clients):
    serialized = clients_schema.dump(clients)
    client_ids = [client["id"] for client in serialized]
    metrics_map = _build_metrics_map(client_ids)

    for client in serialized:
        client["metrics"] = metrics_map.get(
            client["id"],
            {
                "jd_count": 0,
                "candidate_count": 0,
                "selected_count": 0,
                "not_selected_count": 0,
            },
        )

    return serialized


@clients_bp.post("")
@jwt_required()
def create_client():
    role = get_jwt().get("role")
    if role != UserRole.ADMIN.value:
        return jsonify({"message": "Forbidden"}), 403

    payload = request.get_json(silent=True) or {}
    try:
        validated_data = client_schema.load(payload)
    except ValidationError as err:
        return jsonify({"errors": err.messages}), 400

    client = Client(
        name=validated_data["name"].strip(),
        industry=validated_data["industry"].strip(),
        contact_email=validated_data["contact_email"].strip().lower(),
    )
    db.session.add(client)
    db.session.commit()

    return jsonify({"client": client_schema.dump(client)}), 201


@clients_bp.get("")
@jwt_required()
def list_clients():
    role = get_jwt().get("role")
    user = _get_current_user()
    if user is None:
        return jsonify({"message": "User not found"}), 404

    if role in {UserRole.ADMIN.value, UserRole.M_RECRUITER.value, UserRole.PANELIST.value}:
        clients = Client.query.order_by(Client.name.asc()).all()
        return jsonify({"clients": _enrich_clients_with_metrics(clients)}), 200

    if role == UserRole.OPERATOR.value:
        op_client_ids = [
            row.client_id
            for row in OperatorClientAssignment.query.filter_by(operator_id=user.id)
            .with_entities(OperatorClientAssignment.client_id)
            .all()
        ]
        if not op_client_ids:
            return jsonify({"clients": []}), 200
        clients = Client.query.filter(Client.id.in_(op_client_ids)).order_by(Client.name.asc()).all()
        return jsonify({"clients": _enrich_clients_with_metrics(clients)}), 200

    if role == UserRole.RECRUITER.value:
        if user.client_id is None:
            return jsonify({"clients": []}), 200

        client = db.session.get(Client, user.client_id)
        if client is None:
            return jsonify({"clients": []}), 200

        return jsonify({"clients": _enrich_clients_with_metrics([client])}), 200

    return jsonify({"message": "Forbidden"}), 403


@clients_bp.get("/<int:client_id>")
@jwt_required()
def get_client(client_id):
    role = get_jwt().get("role")
    user = _get_current_user()
    if user is None:
        return jsonify({"message": "User not found"}), 404

    client = db.session.get(Client, client_id)
    if client is None:
        return jsonify({"error": "Client not found"}), 404

    if not _can_access_client(role, user, client):
        return jsonify({"message": "Forbidden"}), 403

    metrics = _build_metrics_map([client.id]).get(
        client.id,
        {
            "jd_count": 0,
            "candidate_count": 0,
            "selected_count": 0,
            "not_selected_count": 0,
        },
    )
    payload = client_schema.dump(client)
    payload["metrics"] = metrics

    return jsonify({"client": payload}), 200


@clients_bp.put("/<int:client_id>")
@jwt_required()
def update_client(client_id):
    role = get_jwt().get("role")
    if role != UserRole.ADMIN.value:
        return jsonify({"message": "Forbidden"}), 403

    client = db.session.get(Client, client_id)
    if client is None:
        return jsonify({"error": "Client not found"}), 404

    payload = request.get_json(silent=True) or {}
    try:
        validated_data = client_schema.load(payload, partial=True)
    except ValidationError as err:
        return jsonify({"errors": err.messages}), 400

    if "name" in validated_data:
        client.name = validated_data["name"].strip()
    if "industry" in validated_data:
        client.industry = validated_data["industry"].strip()
    if "contact_email" in validated_data:
        client.contact_email = validated_data["contact_email"].strip().lower()
    if "is_active" in validated_data:
        client.is_active = validated_data["is_active"]

    db.session.commit()
    return jsonify({"client": client_schema.dump(client)}), 200


@clients_bp.post("/<int:client_id>/assign-user")
@jwt_required()
def assign_user_to_client(client_id):
    role = get_jwt().get("role")
    if role != UserRole.ADMIN.value:
        return jsonify({"message": "Forbidden"}), 403

    client = db.session.get(Client, client_id)
    if client is None:
        return jsonify({"error": "Client not found"}), 404

    payload = request.get_json(silent=True) or {}
    user_id = payload.get("user_id")
    if not isinstance(user_id, int):
        return jsonify({"errors": {"user_id": ["Not a valid integer."]}}), 400

    user = db.session.get(User, user_id)
    if user is None:
        return jsonify({"error": "User not found"}), 404

    user.client_id = client.id
    db.session.commit()

    return jsonify({"message": "User assigned successfully", "user": {"id": user.id, "client_id": user.client_id}}), 200


@clients_bp.delete("/<int:client_id>")
@jwt_required()
def delete_client(client_id):
    role = get_jwt().get("role")
    if role != UserRole.ADMIN.value:
        return jsonify({"message": "Forbidden"}), 403

    client = db.session.get(Client, client_id)
    if client is None:
        return jsonify({"error": "Client not found"}), 404

    has_jds = db.session.query(JobDescription.id).filter_by(client_id=client_id).first() is not None
    try:
        has_candidates = db.session.query(Candidate.id).filter_by(client_id=client_id).first() is not None
    except ProgrammingError:
        db.session.rollback()
        has_candidates = False

    if has_jds or has_candidates:
        return jsonify({"error": "Cannot delete client with linked JDs or candidates."}), 409

    db.session.delete(client)
    db.session.commit()
    return jsonify({"message": "Client deleted successfully"}), 200