from datetime import datetime, timezone

from app.extensions import db


class JDRecruiterAssignment(db.Model):
    __tablename__ = "jd_recruiter_assignments"

    id = db.Column(db.Integer, primary_key=True)
    jd_id = db.Column(db.Integer, db.ForeignKey("job_descriptions.id"), nullable=False)
    recruiter_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    assigned_by = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    # Unique constraint on jd_id and recruiter_id
    __table_args__ = (db.UniqueConstraint("jd_id", "recruiter_id", name="uq_jd_recruiter"),)

    job_description = db.relationship("JobDescription", backref="recruiter_assignments", lazy=True)
    recruiter = db.relationship("User", foreign_keys=[recruiter_id], backref="assigned_jds", lazy=True)
    assigned_by_user = db.relationship("User", foreign_keys=[assigned_by], backref="jd_assignments_made", lazy=True)

    def __repr__(self) -> str:
        return f"<JDRecruiterAssignment jd={self.jd_id} recruiter={self.recruiter_id}>"
