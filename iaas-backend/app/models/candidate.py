from datetime import datetime, timezone

from app.extensions import db
from sqlalchemy import UniqueConstraint


CANDIDATE_STATUSES = [
    "APPLIED",
    "SHORTLISTED",
    "INTERVIEWED",
    "SELECTED",
    "NOT_SELECTED",
]


class Candidate(db.Model):
    __tablename__ = "candidates"
    __table_args__ = (
        UniqueConstraint('email', 'jd_id', name='uq_candidate_email_jd'),
    )

    id = db.Column(db.Integer, primary_key=True)
    client_id = db.Column(db.Integer, db.ForeignKey("clients.id"), nullable=False)
    jd_id = db.Column(db.Integer, db.ForeignKey("job_descriptions.id"), nullable=False)
    full_name = db.Column(db.String(255), nullable=False)
    email = db.Column(db.String(255), nullable=False)
    status = db.Column(
        db.Enum(*CANDIDATE_STATUSES, name="candidate_status_enum"),
        nullable=False,
        default="APPLIED",
    )
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    client = db.relationship("Client", back_populates="candidates", lazy=True)
    job_description = db.relationship("JobDescription", back_populates="candidates", lazy=True)

    def __repr__(self) -> str:
        return f"<Candidate {self.full_name}>"
