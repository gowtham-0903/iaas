from datetime import datetime, timezone
from enum import Enum

from passlib.context import CryptContext

from app.extensions import db


pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


class UserRole(str, Enum):
    ADMIN = "ADMIN"
    M_RECRUITER = "M_RECRUITER"
    SR_RECRUITER = "SR_RECRUITER"
    RECRUITER = "RECRUITER"
    PANELIST = "PANELIST"
    QC = "QC"
    CLIENT = "CLIENT"


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    full_name = db.Column(db.String(255), nullable=False)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(32), nullable=False, default=UserRole.RECRUITER.value)
    client_id = db.Column(db.Integer, db.ForeignKey("clients.id"), nullable=True)
    reports_to = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    client = db.relationship("Client", back_populates="users", lazy=True)
    manager = db.relationship("User", remote_side=[id], backref="direct_reports", lazy=True)

    def set_password(self, raw_password: str) -> None:
        self.password_hash = pwd_context.hash(raw_password)

    def check_password(self, raw_password: str) -> bool:
        return pwd_context.verify(raw_password, self.password_hash)

    def __repr__(self) -> str:
        return f"<User {self.email}>"
