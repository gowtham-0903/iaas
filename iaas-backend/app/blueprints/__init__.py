from app.blueprints.auth import auth_bp
from app.blueprints.candidates import candidates_bp
from app.blueprints.client_portal import client_portal_bp
from app.blueprints.clients import clients_bp
from app.blueprints.interviews import interviews_bp
from app.blueprints.job_descriptions import jds_bp
from app.blueprints.qc import qc_bp
from app.blueprints.scoring import scoring_bp
from app.blueprints.users import users_bp


def register_blueprints(app):
    app.register_blueprint(auth_bp)
    app.register_blueprint(candidates_bp)
    app.register_blueprint(client_portal_bp, url_prefix="/api/client-portal")
    app.register_blueprint(clients_bp, url_prefix="/api/clients")
    app.register_blueprint(interviews_bp, url_prefix="/api/interviews")
    app.register_blueprint(jds_bp, url_prefix="/api/jds")
    app.register_blueprint(qc_bp, url_prefix="/api/qc")
    app.register_blueprint(scoring_bp, url_prefix="/api/scoring")
    app.register_blueprint(users_bp)
