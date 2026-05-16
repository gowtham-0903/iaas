from datetime import datetime, timezone

from app.extensions import db


class InterviewScore(db.Model):
    __tablename__ = "interview_scores"

    id = db.Column(db.Integer, primary_key=True)
    interview_id = db.Column(db.Integer, db.ForeignKey("interview_schedules.id"), nullable=False)
    panelist_id = db.Column(db.Integer, db.ForeignKey("panelists.id"), nullable=False)
    skill_id = db.Column(db.Integer, db.ForeignKey("jd_skills.id"), nullable=False)
    overall_score = db.Column(db.Integer, nullable=True)
    technical_score = db.Column(db.Integer, nullable=True)
    communication_score = db.Column(db.Integer, nullable=True)
    problem_solving_score = db.Column(db.Integer, nullable=True)
    comments = db.Column(db.Text, nullable=True)
    submitted_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))


class InterviewTranscript(db.Model):
    __tablename__ = "interview_transcripts"

    id = db.Column(db.Integer, primary_key=True)
    interview_id = db.Column(db.Integer, db.ForeignKey("interview_schedules.id"), nullable=False, unique=True)
    uploaded_by = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    file_url = db.Column(db.String(500), nullable=True)
    raw_text = db.Column(db.Text, nullable=True)
    upload_type = db.Column(db.Enum("file", "text", name="upload_type_enum"), nullable=True)
    uploaded_at = db.Column(db.DateTime, nullable=True)
    # M4 Phase 1 — Teams transcript fetch
    source = db.Column(
        db.Enum("manual_upload", "teams_fetch", name="transcript_source_enum"),
        nullable=False,
        default="manual_upload",
    )
    fetched_at = db.Column(db.DateTime, nullable=True)
    vtt_raw = db.Column(db.Text, nullable=True)       # raw VTT string from Teams
    parsed_text = db.Column(db.Text, nullable=True)   # clean dialogue text


class AIInterviewScore(db.Model):
    __tablename__ = "ai_interview_scores"

    id = db.Column(db.Integer, primary_key=True)
    interview_id = db.Column(db.Integer, db.ForeignKey("interview_schedules.id"), nullable=False, unique=True)
    transcript_id = db.Column(db.Integer, db.ForeignKey("interview_transcripts.id"), nullable=True)
    overall_score = db.Column(db.Numeric(5, 2), nullable=True)
    skill_scores = db.Column(db.JSON, nullable=True)
    strengths = db.Column(db.JSON, nullable=True)
    concerns = db.Column(db.JSON, nullable=True)
    recommendation = db.Column(db.Enum("STRONG_HIRE", "HIRE", "MAYBE", "NO_HIRE", name="ai_recommendation_enum"), nullable=True)
    ai_raw_response = db.Column(db.Text, nullable=True)
    generated_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    report_status = db.Column(db.Enum("PENDING", "GENERATED", "FAILED", name="ai_report_status_enum"), nullable=False, default="PENDING")
    # M4 Phase 1 — report distribution tracking
    report_distributed = db.Column(db.Boolean, nullable=False, default=False)
    distributed_at = db.Column(db.DateTime, nullable=True)
    distribution_log = db.Column(db.JSON, nullable=True)
    # M4 Phase 2 — extended scoring report fields
    primary_match = db.Column(db.Numeric(5, 2), nullable=True)    # avg primary skill % (0-100)
    secondary_match = db.Column(db.Numeric(5, 2), nullable=True)  # avg secondary skill % (0-100)
    skill_breakdown = db.Column(db.JSON, nullable=True)           # skill_scores list from GPT
    ai_suggestion = db.Column(db.Text, nullable=True)             # full GPT JSON response
