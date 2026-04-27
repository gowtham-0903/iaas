from datetime import datetime, timezone

from app.extensions import db


class InterviewSchedule(db.Model):
    __tablename__ = "interview_schedules"

    id = db.Column(db.Integer, primary_key=True)
    candidate_id = db.Column(db.Integer, db.ForeignKey("candidates.id"), nullable=False)
    jd_id = db.Column(db.Integer, db.ForeignKey("job_descriptions.id"), nullable=False)
    scheduled_at = db.Column(db.DateTime, nullable=False)
    duration_minutes = db.Column(db.Integer, nullable=True, default=60)
    mode = db.Column(db.String(32), nullable=False)
    meeting_link = db.Column(db.String(500), nullable=True)
    notes = db.Column(db.Text, nullable=True)
    status = db.Column(
        db.Enum("SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED", name="interview_status_enum"),
        nullable=False,
        default="SCHEDULED",
    )
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class PanelAssignment(db.Model):
    __tablename__ = "panel_assignments"

    interview_id = db.Column(db.Integer, db.ForeignKey("interview_schedules.id"), primary_key=True)
    panelist_id = db.Column(db.Integer, db.ForeignKey("users.id"), primary_key=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class PanelistAvailability(db.Model):
    __tablename__ = "panelist_availability"

    id = db.Column(db.Integer, primary_key=True)
    panelist_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    available_date = db.Column(db.Date, nullable=False)
    start_time = db.Column(db.Time, nullable=False)
    end_time = db.Column(db.Time, nullable=False)
    is_booked = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
