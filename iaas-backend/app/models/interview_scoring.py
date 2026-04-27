from datetime import datetime, timezone

from app.extensions import db


class InterviewScore(db.Model):
    __tablename__ = "interview_scores"

    id = db.Column(db.Integer, primary_key=True)
    interview_id = db.Column(db.Integer, db.ForeignKey("interview_schedules.id"), nullable=False)
    panelist_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    skill_id = db.Column(db.Integer, db.ForeignKey("jd_skills.id"), nullable=False)
    technical_score = db.Column(db.Integer, nullable=False)
    communication_score = db.Column(db.Integer, nullable=False)
    problem_solving_score = db.Column(db.Integer, nullable=False)
    comments = db.Column(db.Text, nullable=True)
    submitted_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))


class InterviewTranscript(db.Model):
    __tablename__ = "interview_transcripts"

    id = db.Column(db.Integer, primary_key=True)
    interview_id = db.Column(db.Integer, db.ForeignKey("interview_schedules.id"), nullable=False, unique=True)
    uploaded_by = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    file_url = db.Column(db.String(500), nullable=True)
    raw_text = db.Column(db.Text, nullable=True)
    upload_type = db.Column(db.Enum("file", "text", name="upload_type_enum"), nullable=False)
    uploaded_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))


class AIInterviewScore(db.Model):
    __tablename__ = "ai_interview_scores"

    id = db.Column(db.Integer, primary_key=True)
    interview_id = db.Column(db.Integer, db.ForeignKey("interview_schedules.id"), nullable=False, unique=True)
    transcript_id = db.Column(db.Integer, db.ForeignKey("interview_transcripts.id"), nullable=False)
    overall_score = db.Column(db.Numeric(5, 2), nullable=True)
    skill_scores = db.Column(db.JSON, nullable=True)
    strengths = db.Column(db.JSON, nullable=True)
    concerns = db.Column(db.JSON, nullable=True)
    recommendation = db.Column(db.Enum("STRONG_HIRE", "HIRE", "MAYBE", "NO_HIRE", name="ai_recommendation_enum"), nullable=True)
    ai_raw_response = db.Column(db.Text, nullable=True)
    generated_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    report_status = db.Column(db.Enum("PENDING", "GENERATED", "FAILED", name="ai_report_status_enum"), nullable=False, default="PENDING")
