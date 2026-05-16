from datetime import datetime, timezone

from app.extensions import db


class Panelist(db.Model):
    __tablename__ = "panelists"

    id = db.Column(db.Integer, primary_key=True)
    panel_id = db.Column(db.String(20), unique=True, nullable=False, index=True)
    name = db.Column(db.String(200), nullable=False)
    skill = db.Column(db.Text, nullable=True)
    email = db.Column(db.String(200), unique=True, nullable=False, index=True)
    phone = db.Column(db.String(30), nullable=True)
    location = db.Column(db.String(200), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    created_by = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    def to_dict(self):
        return {
            "id": self.id,
            "panel_id": self.panel_id,
            "name": self.name,
            "skill": self.skill or "",
            "email": self.email,
            "phone": self.phone or "",
            "location": self.location or "",
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "created_by": self.created_by,
        }
