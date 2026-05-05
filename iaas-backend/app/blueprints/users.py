from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt, get_jwt_identity, jwt_required
from marshmallow import ValidationError

from app.extensions import db
from app.models.operator_client_assignment import OperatorClientAssignment
from app.models.user import User, UserRole
from app.schemas.user_schema import create_user_schema, update_user_schema, user_schema, users_schema


users_bp = Blueprint("users", __name__, url_prefix="/api/users")

RECRUITER_ROLES = {
    UserRole.M_RECRUITER.value,
    UserRole.SR_RECRUITER.value,
    UserRole.RECRUITER.value,
}


def _get_current_user():
    user_id = get_jwt_identity()
    return User.query.get(int(user_id)) if user_id else None


def _serialize_user(user: User) -> dict:
    data = user_schema.dump(user)
    if user.role == UserRole.OPERATOR.value:
        assignments = OperatorClientAssignment.query.filter_by(operator_id=user.id).all()
        data["client_ids"] = [a.client_id for a in assignments]
    return data


def _serialize_users(users: list) -> list:
    return [_serialize_user(u) for u in users]


def _sync_operator_clients(operator_id: int, client_ids: list) -> None:
    OperatorClientAssignment.query.filter_by(operator_id=operator_id).delete()
    for client_id in client_ids:
        db.session.add(OperatorClientAssignment(operator_id=operator_id, client_id=client_id))



def _can_manage_user(actor, target_user):
    if actor.role == UserRole.ADMIN.value:
        return True

    if actor.client_id is None or actor.client_id != target_user.client_id:
        return False

    if actor.role == UserRole.M_RECRUITER.value:
        return target_user.role in {
            UserRole.SR_RECRUITER.value,
            UserRole.RECRUITER.value,
        }

    if actor.role == UserRole.SR_RECRUITER.value:
        return target_user.role == UserRole.RECRUITER.value

    return False


def _validate_managed_role_and_client(actor, target_role, target_client_id):
    if actor.role == UserRole.ADMIN.value:
        return None

    if actor.client_id is None or target_client_id != actor.client_id:
        return "Must manage users in your own client"

    if actor.role == UserRole.M_RECRUITER.value and target_role not in {
        UserRole.SR_RECRUITER.value,
        UserRole.RECRUITER.value,
    }:
        return "M_RECRUITER can only manage SR_RECRUITER or RECRUITER"

    if actor.role == UserRole.SR_RECRUITER.value and target_role != UserRole.RECRUITER.value:
        return "SR_RECRUITER can only manage RECRUITER"

    return None


def _validate_reports_to(target_role, target_client_id, reports_to):
    if reports_to is None:
        return None

    manager = User.query.get(int(reports_to))

    if target_role == UserRole.SR_RECRUITER.value:
        if (
            manager is None
            or manager.role != UserRole.M_RECRUITER.value
            or manager.client_id != target_client_id
        ):
            return "Manager must be an M_RECRUITER in the same client"

    if target_role == UserRole.RECRUITER.value:
        if (
            manager is None
            or manager.role not in {UserRole.SR_RECRUITER.value, UserRole.M_RECRUITER.value}
            or manager.client_id != target_client_id
        ):
            return "Manager must be an SR_RECRUITER or M_RECRUITER in the same client"

    return None


@users_bp.get("")
@jwt_required()
def list_users():
    role = get_jwt().get("role")
    current_user = _get_current_user()
    if current_user is None:
        return jsonify({"message": "User not found"}), 404

    if role in {UserRole.ADMIN.value, UserRole.M_RECRUITER.value, UserRole.SR_RECRUITER.value, UserRole.PANELIST.value, UserRole.OPERATOR.value}:
        query = User.query.filter(User.id != current_user.id)
        
        if role not in {UserRole.ADMIN.value, UserRole.PANELIST.value, UserRole.OPERATOR.value}:
            # Recruiters see users in their own client
            query = query.filter(User.client_id == current_user.client_id)
            
        users = query.order_by(User.full_name.asc()).all()
        return jsonify({"users": _serialize_users(users)}), 200

    return jsonify({"message": "Forbidden"}), 403


@users_bp.get("/by-client/<int:client_id>")
@jwt_required()
def list_users_by_client(client_id):
    role = get_jwt().get("role")
    if role not in {
        UserRole.ADMIN.value,
        UserRole.M_RECRUITER.value,
        UserRole.SR_RECRUITER.value,
    }:
        return jsonify({"message": "Forbidden"}), 403

    if role in {UserRole.M_RECRUITER.value, UserRole.SR_RECRUITER.value}:
        current_user = _get_current_user()
        if current_user is None:
            return jsonify({"message": "User not found"}), 404
        if current_user.client_id != client_id:
            return jsonify({"message": "Forbidden"}), 403

    users = (
        User.query.filter_by(client_id=client_id, is_active=True)
        .order_by(User.full_name.asc())
        .all()
    )

    return jsonify({
        "users": [
            {
                "id": user.id,
                "full_name": user.full_name,
                "role": user.role,
                "email": user.email,
            }
            for user in users
        ]
    }), 200


@users_bp.post("")
@jwt_required()
def create_user():
    role = get_jwt().get("role")
    if role not in {
        UserRole.ADMIN.value,
        UserRole.M_RECRUITER.value,
        UserRole.SR_RECRUITER.value,
    }:
        return jsonify({"message": "Forbidden"}), 403

    current_user = None
    if role != UserRole.ADMIN.value:
        current_user = _get_current_user()
        if current_user is None:
            return jsonify({"message": "User not found"}), 404

    payload = request.get_json(silent=True) or {}

    try:
        validated_data = create_user_schema.load(payload)
    except ValidationError as err:
        return jsonify({"errors": err.messages}), 400

    target_role = validated_data.get("role")
    target_client_id = validated_data.get("client_id")
    target_client_ids = validated_data.get("client_ids") or []
    target_reports_to = validated_data.get("reports_to")

    if target_role == UserRole.OPERATOR.value:
        if role != UserRole.ADMIN.value:
            return jsonify({"message": "Only ADMIN can create OPERATOR users"}), 403
        if not target_client_ids:
            return jsonify({"message": "At least one client is required for OPERATOR"}), 400
    elif target_role in RECRUITER_ROLES and target_client_id is None:
        return jsonify({"message": "Client is required for recruiter roles"}), 400

    # Role-based creation rules
    if role == UserRole.M_RECRUITER.value:
        if target_role not in {UserRole.SR_RECRUITER.value, UserRole.RECRUITER.value}:
            return jsonify({"message": "M_RECRUITER can only create SR_RECRUITER or RECRUITER"}), 403
        if current_user.client_id is None or target_client_id != current_user.client_id:
            return jsonify({"message": "Must create users in your own client"}), 403
    elif role == UserRole.SR_RECRUITER.value:
        if target_role != UserRole.RECRUITER.value:
            return jsonify({"message": "SR_RECRUITER can only create RECRUITER"}), 403
        if current_user.client_id is None or target_client_id != current_user.client_id:
            return jsonify({"message": "Must create users in your own client"}), 403

    manager_error = _validate_reports_to(target_role, target_client_id, target_reports_to)
    if manager_error:
        return jsonify({"message": manager_error}), 400

    existing_user = User.query.filter_by(email=validated_data["email"].strip().lower()).first()
    if existing_user is not None:
        return jsonify({"errors": {"email": ["Email is already in use"]}}), 400

    user = User(
        full_name=validated_data["full_name"],
        email=validated_data["email"].strip().lower(),
        role=validated_data["role"],
        client_id=None if target_role == UserRole.OPERATOR.value else validated_data.get("client_id"),
        reports_to=validated_data.get("reports_to"),
        is_active=validated_data.get("is_active", True),
    )
    user.set_password(validated_data["password"])

    db.session.add(user)
    db.session.flush()

    if target_role == UserRole.OPERATOR.value:
        _sync_operator_clients(user.id, target_client_ids)

    db.session.commit()

    return jsonify({"user": _serialize_user(user)}), 201


@users_bp.put("/<int:user_id>")
@jwt_required()
def update_user(user_id):
    role = get_jwt().get("role")
    if role not in {
        UserRole.ADMIN.value,
        UserRole.M_RECRUITER.value,
        UserRole.SR_RECRUITER.value,
    }:
        return jsonify({"message": "Forbidden"}), 403

    user = User.query.get(user_id)
    if user is None:
        return jsonify({"error": "User not found"}), 404

    current_user = _get_current_user()
    if current_user is None:
        return jsonify({"message": "User not found"}), 404

    if not _can_manage_user(current_user, user):
        return jsonify({"message": "Forbidden"}), 403

    payload = request.get_json(silent=True) or {}

    try:
        validated_data = update_user_schema.load(payload)
    except ValidationError as err:
        return jsonify({"errors": err.messages}), 400

    target_role = validated_data.get("role", user.role)
    target_client_id = validated_data.get("client_id", user.client_id)

    role_validation_error = _validate_managed_role_and_client(
        current_user,
        target_role,
        target_client_id,
    )
    if role_validation_error:
        return jsonify({"message": role_validation_error}), 403

    if target_role in RECRUITER_ROLES and target_client_id is None:
        return jsonify({"message": "Client is required for recruiter roles"}), 400

    if "reports_to" in validated_data and validated_data["reports_to"] is not None:
        manager_error = _validate_reports_to(
            target_role,
            target_client_id,
            validated_data["reports_to"],
        )
        if manager_error:
            return jsonify({"message": manager_error}), 400

    if "email" in validated_data:
        normalized_email = validated_data["email"].strip().lower()
        existing_user = User.query.filter(User.email == normalized_email, User.id != user_id).first()
        if existing_user is not None:
            return jsonify({"errors": {"email": ["Email is already in use"]}}), 400
        user.email = normalized_email

    # Update fields if provided
    if "full_name" in validated_data:
        user.full_name = validated_data["full_name"]
    
    if "role" in validated_data:
        user.role = validated_data["role"]
    
    if "is_active" in validated_data:
        user.is_active = validated_data["is_active"]
    
    if "client_id" in validated_data:
        user.client_id = validated_data["client_id"]
    
    if "reports_to" in validated_data:
        user.reports_to = validated_data["reports_to"]
    
    if "password" in validated_data and validated_data["password"] is not None:
        user.set_password(validated_data["password"])

    if user.role == UserRole.OPERATOR.value and validated_data.get("client_ids") is not None:
        _sync_operator_clients(user.id, validated_data["client_ids"])

    db.session.commit()

    return jsonify({"user": _serialize_user(user)}), 200


@users_bp.delete("/<int:user_id>")
@jwt_required()
def delete_user(user_id):
    role = get_jwt().get("role")
    if role not in {
        UserRole.ADMIN.value,
        UserRole.M_RECRUITER.value,
        UserRole.SR_RECRUITER.value,
    }:
        return jsonify({"message": "Forbidden"}), 403

    user = User.query.get(user_id)
    if user is None:
        return jsonify({"error": "User not found"}), 404

    current_user = _get_current_user()
    if current_user is None:
        return jsonify({"message": "User not found"}), 404

    if not _can_manage_user(current_user, user):
        return jsonify({"message": "Forbidden"}), 403

    db.session.delete(user)
    db.session.commit()

    return jsonify({"message": "User deleted successfully"}), 200
