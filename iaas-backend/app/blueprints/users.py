from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required

from app.models.user import User
from app.schemas.user_schema import users_schema


users_bp = Blueprint("users", __name__, url_prefix="/api/users")


@users_bp.get("")
@jwt_required()
def list_users():
    users = User.query.order_by(User.full_name.asc()).all()
    return jsonify({"users": users_schema.dump(users)}), 200
