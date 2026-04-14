from app.blueprints.auth import auth_bp
from app.blueprints.users import users_bp


def register_blueprints(app):
    app.register_blueprint(auth_bp)
    app.register_blueprint(users_bp)
