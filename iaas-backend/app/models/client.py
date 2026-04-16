from datetime import datetime, timezone

from app.extensions import db


class Client(db.Model):
    __tablename__ = "clients"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False)
    industry = db.Column(db.String(255), nullable=True)
    contact_email = db.Column(db.String(255), nullable=True)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    users = db.relationship("User", back_populates="client", lazy=True)
    candidates = db.relationship("Candidate", back_populates="client", lazy=True)

    def __repr__(self) -> str:
        return f"<Client {self.name}>"
