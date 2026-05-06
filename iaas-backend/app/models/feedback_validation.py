from datetime import datetime, timezone

from app.extensions import db


class FeedbackValidation(db.Model):
    __tablename__ = "feedback_validations"

    id = db.Column(db.Integer, primary_key=True)
    interview_id = db.Column(db.Integer, db.ForeignKey("interview_schedules.id"), nullable=False, unique=True)
    validated_by = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    status = db.Column(db.Enum("PENDING", "VALIDATED", name="fv_status_enum"), nullable=False, default="PENDING")
    final_recommendation = db.Column(db.String(50), nullable=True)
    qc_notes = db.Column(db.Text, nullable=True)
    skill_overrides = db.Column(db.Text, nullable=True)
    approved = db.Column(db.Boolean, nullable=False, default=False)
    validated_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
