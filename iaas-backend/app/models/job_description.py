from datetime import datetime, timezone

from app.extensions import db


class JobDescription(db.Model):
    __tablename__ = "job_descriptions"

    id = db.Column(db.Integer, primary_key=True)
    client_id = db.Column(db.Integer, db.ForeignKey("clients.id"), nullable=False)
    title = db.Column(db.String(255), nullable=False)
    job_code = db.Column(db.String(20), unique=True, nullable=True, index=True)
    raw_text = db.Column(db.Text, nullable=True)
    file_url = db.Column(db.String(500), nullable=True)
    calibration_url = db.Column(db.String(500), nullable=True)
    rate_scale = db.Column(db.String(255), nullable=True)
    skills_extraction_hash = db.Column(db.String(64), nullable=True)
    skills_extracted_at = db.Column(db.DateTime, nullable=True)
    status = db.Column(
        db.Enum("DRAFT", "ACTIVE", "CLOSED", name="jd_status_enum"),
        nullable=False,
        default="DRAFT",
    )
    created_by = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    client = db.relationship("Client", backref="job_descriptions", lazy=True)
    skills = db.relationship("JDSkill", back_populates="job_description", lazy=True, cascade="all, delete-orphan")
    candidates = db.relationship("Candidate", back_populates="job_description", lazy=True, cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<JobDescription {self.title}>"
