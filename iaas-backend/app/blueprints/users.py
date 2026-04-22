from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt, get_jwt_identity, jwt_required
from marshmallow import ValidationError

from app.extensions import db
from app.models.user import User, UserRole
from app.schemas.user_schema import create_user_schema, update_user_schema, user_schema, users_schema


users_bp = Blueprint("users", __name__, url_prefix="/api/users")


@users_bp.get("")
@jwt_required()
def list_users():
    role = get_jwt().get("role")
    if role != "ADMIN":
        return jsonify({"message": "Forbidden"}), 403

    users = User.query.order_by(User.full_name.asc()).all()
    return jsonify({"users": users_schema.dump(users)}), 200


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
        user_id = get_jwt_identity()
        current_user = User.query.get(int(user_id)) if user_id else None
        if current_user is None:
            return jsonify({"message": "User not found"}), 404

    payload = request.get_json(silent=True) or {}

    try:
        validated_data = create_user_schema.load(payload)
    except ValidationError as err:
        return jsonify({"errors": err.messages}), 400

    target_role = validated_data.get("role")
    target_client_id = validated_data.get("client_id")

    # Role-based creation rules
    if role == UserRole.M_RECRUITER.value:
        # M_RECRUITER can create SR_RECRUITER or RECRUITER in their client
        if target_role not in {UserRole.SR_RECRUITER.value, UserRole.RECRUITER.value}:
            return jsonify({"message": "M_RECRUITER can only create SR_RECRUITER or RECRUITER"}), 403
        if current_user.client_id is None or target_client_id != current_user.client_id:
            return jsonify({"message": "Must create users in your own client"}), 403
    elif role == UserRole.SR_RECRUITER.value:
        # SR_RECRUITER can create RECRUITER in their client
        if target_role != UserRole.RECRUITER.value:
            return jsonify({"message": "SR_RECRUITER can only create RECRUITER"}), 403
        if current_user.client_id is None or target_client_id != current_user.client_id:
            return jsonify({"message": "Must create users in your own client"}), 403

    existing_user = User.query.filter_by(email=validated_data["email"].strip().lower()).first()
    if existing_user is not None:
        return jsonify({"errors": {"email": ["Email is already in use"]}}), 400

    user = User(
        full_name=validated_data["full_name"],
        email=validated_data["email"].strip().lower(),
        role=validated_data["role"],
        client_id=validated_data.get("client_id"),
        reports_to=validated_data.get("reports_to"),
        is_active=validated_data.get("is_active", True),
    )
    user.set_password(validated_data["password"])

    db.session.add(user)
    db.session.commit()

    return jsonify({"user": user_schema.dump(user)}), 201


@users_bp.put("/<int:user_id>")
@jwt_required()
def update_user(user_id):
    role = get_jwt().get("role")
    if role != "ADMIN":
        return jsonify({"message": "Forbidden"}), 403

    user = User.query.get(user_id)
    if user is None:
        return jsonify({"error": "User not found"}), 404

    payload = request.get_json(silent=True) or {}

    try:
        validated_data = update_user_schema.load(payload)
    except ValidationError as err:
        return jsonify({"errors": err.messages}), 400

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

    db.session.commit()

    return jsonify({"user": user_schema.dump(user)}), 200


@users_bp.delete("/<int:user_id>")
@jwt_required()
def delete_user(user_id):
    role = get_jwt().get("role")
    if role != "ADMIN":
        return jsonify({"message": "Forbidden"}), 403

    user = User.query.get(user_id)
    if user is None:
        return jsonify({"error": "User not found"}), 404

    db.session.delete(user)
    db.session.commit()

    return jsonify({"message": "User deleted successfully"}), 200
