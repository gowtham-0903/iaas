from app.extensions import db


class OperatorClientAssignment(db.Model):
    __tablename__ = "operator_client_assignments"

    id = db.Column(db.Integer, primary_key=True)
    operator_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    client_id = db.Column(db.Integer, db.ForeignKey("clients.id", ondelete="CASCADE"), nullable=False)

    __table_args__ = (
        db.UniqueConstraint("operator_id", "client_id", name="uq_operator_client"),
    )

    operator = db.relationship("User", backref=db.backref("client_assignments", lazy="dynamic", passive_deletes=True))
    client = db.relationship("Client", backref=db.backref("operator_assignments", lazy="dynamic", passive_deletes=True))
