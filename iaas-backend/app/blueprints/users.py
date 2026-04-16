from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required
from marshmallow import ValidationError

from app.extensions import db
from app.models.user import User
from app.schemas.user_schema import create_user_schema, update_user_schema, user_schema, users_schema


users_bp = Blueprint("users", __name__, url_prefix="/api/users")


@users_bp.get("")
@jwt_required()
def list_users():
    users = User.query.order_by(User.full_name.asc()).all()
    return jsonify({"users": users_schema.dump(users)}), 200


@users_bp.post("")
@jwt_required()
def create_user():
    payload = request.get_json(silent=True) or {}

    try:
        validated_data = create_user_schema.load(payload)
    except ValidationError as err:
        return jsonify({"errors": err.messages}), 400

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
    user = User.query.get(user_id)
    if user is None:
        return jsonify({"error": "User not found"}), 404

    db.session.delete(user)
    db.session.commit()

    return jsonify({"message": "User deleted successfully"}), 200
