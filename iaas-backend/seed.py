from app import create_app
from app.extensions import db
from app.models.user import User, UserRole


DEFAULT_ADMIN = {
    "full_name": "Admin",
    "email": "admin@meedenlabs.com",
    "password": "admin@#1234",
    "role": UserRole.ADMIN.value,
}


def seed_admin_user() -> None:
    existing_user = User.query.filter_by(email=DEFAULT_ADMIN["email"]).first()
    if existing_user:
        print("Admin user already exists. No changes made.")
        return

    admin_user = User(
        full_name=DEFAULT_ADMIN["full_name"],
        email=DEFAULT_ADMIN["email"],
        role=DEFAULT_ADMIN["role"],
        is_active=True,
    )
    admin_user.set_password(DEFAULT_ADMIN["password"])

    db.session.add(admin_user)
    db.session.commit()
    print("Admin user created successfully.")


def main() -> None:
    app = create_app()
    with app.app_context():
        seed_admin_user()


if __name__ == "__main__":
    main()
