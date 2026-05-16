from datetime import datetime, timezone

from app.extensions import db


class JDPanelistAssignment(db.Model):
    __tablename__ = "jd_panelist_assignments"
    __table_args__ = (db.UniqueConstraint("jd_id", "panelist_id", name="uq_jd_panelist"),)

    id = db.Column(db.Integer, primary_key=True)
    jd_id = db.Column(db.Integer, db.ForeignKey("job_descriptions.id"), nullable=False)
    panelist_id = db.Column(db.Integer, db.ForeignKey("panelists.id"), nullable=False)
    client_id = db.Column(db.Integer, db.ForeignKey("clients.id"), nullable=False)
    assigned_by = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    job_description = db.relationship("JobDescription", backref="panelist_assignments", lazy=True)
    panelist = db.relationship("Panelist", foreign_keys=[panelist_id], backref="assigned_jds", lazy=True)
    client = db.relationship("Client", backref="panelist_assignments", lazy=True)
    assigned_by_user = db.relationship("User", foreign_keys=[assigned_by], backref="panelist_assignments_made", lazy=True)

    def __repr__(self) -> str:
        return f"<JDPanelistAssignment jd={self.jd_id} panelist={self.panelist_id}>"
