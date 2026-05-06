from datetime import datetime, timedelta, timezone

from flask import Blueprint, jsonify, request
from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    get_jwt,
    get_jwt_identity,
    jwt_required,
    set_access_cookies,
    set_refresh_cookies,
    unset_jwt_cookies,
)
from marshmallow import ValidationError

from app.extensions import db, limiter
from app.models.revoked_token import RevokedToken
from app.models.user import User
from app.schemas.auth_schema import login_schema
from app.schemas.user_schema import user_schema


auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")

_REVOKED_TOKEN_TTL_DAYS = 7


def _cleanup_expired_revoked_tokens():
    """Delete revoked tokens older than the refresh token TTL (lazy cleanup on login)."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=_REVOKED_TOKEN_TTL_DAYS)
    try:
        RevokedToken.query.filter(RevokedToken.revoked_at < cutoff).delete()
        db.session.commit()
    except Exception:
        db.session.rollback()


def jwt_refresh_token_required(fn):
    return jwt_required(refresh=True)(fn)


def _token_claims_for_user(user):
    return {
        "role": user.role,
        "client_id": user.client_id,
    }


@auth_bp.post("/login")
@limiter.limit("5 per minute")
def login():
    payload = request.get_json(silent=True) or {}

    try:
        validated_payload = login_schema.load(payload)
    except ValidationError as err:
        return jsonify({"errors": err.messages}), 400

    email = validated_payload["email"].strip().lower()
    password = validated_payload["password"]

    user = User.query.filter_by(email=email, is_active=True).first()
    if user is None or not user.check_password(password):
        return jsonify({"error": "Invalid credentials"}), 401

    _cleanup_expired_revoked_tokens()

    access_token = create_access_token(identity=str(user.id), additional_claims=_token_claims_for_user(user))
    refresh_token = create_refresh_token(identity=str(user.id), additional_claims=_token_claims_for_user(user))

    response = jsonify({"user": user_schema.dump(user)})
    set_access_cookies(response, access_token)
    set_refresh_cookies(response, refresh_token)
    return response, 200


@auth_bp.post("/refresh")
@jwt_refresh_token_required
def refresh():
    user_id = get_jwt_identity()
    user = db.session.get(User, int(user_id))
    if user is None or not user.is_active:
        return jsonify({"error": "Invalid credentials"}), 401

    access_token = create_access_token(identity=str(user.id), additional_claims=_token_claims_for_user(user))
    response = jsonify({"message": "Token refreshed"})
    set_access_cookies(response, access_token)
    return response, 200


@auth_bp.post("/logout")
@jwt_required(verify_type=False)
def logout():
    jti = get_jwt().get("jti")

    existing_entry = RevokedToken.query.filter_by(jti=jti).first()
    if existing_entry is None:
        db.session.add(RevokedToken(jti=jti))
        db.session.commit()

    response = jsonify({"message": "Logged out successfully"})
    unset_jwt_cookies(response)
    return response, 200


@auth_bp.get("/me")
@jwt_required()
def me():
    user_id = get_jwt_identity()
    user = db.session.get(User, int(user_id))
    if user is None:
        return jsonify({"message": "User not found"}), 404

    return jsonify(user_schema.dump(user)), 200
