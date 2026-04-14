from flask import Flask, jsonify
from flask_cors import CORS

from app.blueprints import register_blueprints
from app.config import Config
from app.extensions import db, jwt, migrate


def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)

    CORS(
        app,
        resources={r"/api/*": {"origins": "http://localhost:5173"}},
        allow_headers=["Content-Type", "Authorization"],
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    )

    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)

    app.config.setdefault("JWT_BLOCKLIST", set())

    @jwt.token_in_blocklist_loader
    def check_if_token_revoked(_jwt_header, jwt_payload):
        return jwt_payload.get("jti") in app.config["JWT_BLOCKLIST"]

    @app.get("/health")
    def health():
        return jsonify({"status": "ok"}), 200

    register_blueprints(app)

    return app
