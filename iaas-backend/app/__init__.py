from flask import Flask, jsonify
from flask_cors import CORS

from app.blueprints import register_blueprints
from app.config import Config
from app.extensions import db, jwt, limiter, migrate
from app.models import Candidate, Client, JDSkill, JobDescription, RevokedToken, User  # noqa: F401


def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)

    CORS(
        app,
        resources={r"/api/*": {"origins": app.config.get("CORS_ORIGINS", ["http://localhost:5173"])}},
        allow_headers=["Content-Type", "Authorization", "X-CSRF-TOKEN"],
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        supports_credentials=True,
    )

    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)
    limiter.init_app(app)

    @jwt.token_in_blocklist_loader
    def check_if_token_revoked(_jwt_header, jwt_payload):
        jti = jwt_payload.get("jti")
        if not jti:
            return False

        return db.session.query(RevokedToken.id).filter_by(jti=jti).first() is not None

    @app.get("/health")
    def health():
        return jsonify({"status": "ok"}), 200

    register_blueprints(app)

    return app