from app.blueprints.auth import auth_bp
from app.blueprints.candidates import candidates_bp
from app.blueprints.clients import clients_bp
from app.blueprints.job_descriptions import jds_bp
from app.blueprints.users import users_bp


def register_blueprints(app):
    app.register_blueprint(auth_bp)
    app.register_blueprint(candidates_bp)
    app.register_blueprint(clients_bp, url_prefix="/api/clients")
    app.register_blueprint(jds_bp, url_prefix="/api/jds")
    app.register_blueprint(users_bp)
