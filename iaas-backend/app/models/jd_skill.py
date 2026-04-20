from app.extensions import db


class JDSkill(db.Model):
    __tablename__ = "jd_skills"

    id = db.Column(db.Integer, primary_key=True)
    jd_id = db.Column(db.Integer, db.ForeignKey("job_descriptions.id"), nullable=False)
    skill_name = db.Column(db.String(255), nullable=False)
    skill_type = db.Column(db.Enum("primary", "secondary", "soft", name="jd_skill_type_enum"), nullable=False)
    importance_level = db.Column(db.String(50), nullable=True)
    subtopics = db.Column(db.JSON, nullable=True)

    job_description = db.relationship("JobDescription", back_populates="skills", lazy=True)

    def __repr__(self) -> str:
        return f"<JDSkill {self.skill_name}>"