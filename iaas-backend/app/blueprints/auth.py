from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import (
    create_access_token,
    get_jwt,
    get_jwt_identity,
    jwt_required,
)

from app.models.user import User
from app.schemas.user_schema import user_schema


auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


@auth_bp.post("/login")
def login():
    payload = request.get_json(silent=True) or {}
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""

    if not email or not password:
        return jsonify({"message": "email and password are required"}), 400

    user = User.query.filter_by(email=email, is_active=True).first()
    if user is None or not user.check_password(password):
        return jsonify({"message": "Invalid email or password"}), 401

    token = create_access_token(identity=str(user.id), additional_claims={"role": user.role})
    return jsonify({"access_token": token, "user": user_schema.dump(user)}), 200


@auth_bp.post("/logout")
@jwt_required()
def logout():
    jti = get_jwt().get("jti")
    current_app.config.setdefault("JWT_BLOCKLIST", set()).add(jti)
    return jsonify({"message": "Logged out successfully"}), 200


@auth_bp.get("/me")
@jwt_required()
def me():
    user_id = get_jwt_identity()
    user = User.query.get(int(user_id))
    if user is None:
        return jsonify({"message": "User not found"}), 404

    return jsonify(user_schema.dump(user)), 200
