from functools import wraps

from flask import jsonify
from flask_jwt_extended import get_jwt, verify_jwt_in_request


ROLE_RANK = {
    "CLIENT": 1,
    "PANELIST": 2,
    "RECRUITER": 3,
    "SR_RECRUITER": 4,
    "M_RECRUITER": 5,
    "QC": 6,
    "ADMIN": 7,
}


def role_required(*allowed_roles: str):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            verify_jwt_in_request()
            claims = get_jwt()
            current_role = claims.get("role")

            if not current_role or current_role not in ROLE_RANK:
                return jsonify({"message": "Invalid role in token"}), 403

            if not allowed_roles:
                return fn(*args, **kwargs)

            min_required_rank = min(ROLE_RANK.get(role, 999) for role in allowed_roles)
            if ROLE_RANK[current_role] < min_required_rank:
                return jsonify({"message": "Forbidden"}), 403

            return fn(*args, **kwargs)

        return wrapper

    return decorator
