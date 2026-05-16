"""AI scoring service — M3 transcript scorer + M4 Phase 2 full scoring engine."""
from __future__ import annotations

import json
import textwrap
import time
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional

from openai import OpenAI
from pydantic import BaseModel, ValidationError, field_validator
import sqlalchemy as sa

from app.extensions import db
from app.models.interview_scoring import AIInterviewScore


# ---------------------------------------------------------------------------
# Shared constants
# ---------------------------------------------------------------------------

SYSTEM_PROMPT_V1 = (
    "You are an expert technical interviewer evaluating "
    "a candidate based on an interview transcript. Return ONLY "
    "valid JSON."
)

SYSTEM_PROMPT_V2 = (
    "You are an expert technical recruiter evaluating interview performance. "
    "Return ONLY valid JSON matching the exact schema provided. No markdown, no explanation."
)

_GPT_MODEL = "gpt-4o"
_MAX_TRANSCRIPT_TOKENS = 6000   # ~24 000 chars at ~4 chars/token
_MAX_TRANSCRIPT_CHARS = _MAX_TRANSCRIPT_TOKENS * 4


# ---------------------------------------------------------------------------
# Phase 1 Pydantic schema (kept for backward compatibility with upload_transcript)
# ---------------------------------------------------------------------------

class Recommendation(str, Enum):
    STRONG_HIRE = "STRONG_HIRE"
    HIRE = "HIRE"
    MAYBE = "MAYBE"
    NO_HIRE = "NO_HIRE"


class SkillScoreItem(BaseModel):
    skill_id: int
    skill_name: str
    score: float
    reasoning: str


class InterviewScoreResponse(BaseModel):
    overall_score: float
    skill_scores: List[SkillScoreItem]
    strengths: List[str]
    concerns: List[str]
    recommendation: Recommendation


# ---------------------------------------------------------------------------
# Phase 2 Pydantic schema
# ---------------------------------------------------------------------------

class SkillScoreItemV2(BaseModel):
    skill_name: str
    skill_type: str
    score: float
    panelist_avg: float
    ai_assessment: str


class SoftSkillRating(BaseModel):
    rating: str
    observation: str


class SoftSkillAnalysis(BaseModel):
    confidence: SoftSkillRating
    communication: SoftSkillRating
    pressure_handling: SoftSkillRating


class AnalyticalRating(BaseModel):
    rating: str
    observation: str


class AnalyticalSkills(BaseModel):
    approach_attitude: AnalyticalRating
    problem_solving: AnalyticalRating
    result_oriented: AnalyticalRating


class FinalRemarks(BaseModel):
    strengths_paragraph: str
    conclusion: str


class ScreeningQuestion(BaseModel):
    question: str
    panelist_notes: str
    ai_assessment: str
    score: float


class AIScoreResponseV2(BaseModel):
    resume_summary: str
    skill_scores: List[SkillScoreItemV2]
    strengths: List[str]
    concerns: List[str]
    screening_question_analysis: List[ScreeningQuestion]
    soft_skill_analysis: SoftSkillAnalysis
    analytical_skills: AnalyticalSkills
    final_remarks: FinalRemarks
    recommendation: Recommendation
    overall_score: float
    confidence_level: str

    @field_validator("overall_score")
    @classmethod
    def clamp_score(cls, v: float) -> float:
        return max(0.0, min(100.0, float(v)))

    @field_validator("confidence_level")
    @classmethod
    def validate_confidence(cls, v: str) -> str:
        if v.upper() not in ("HIGH", "MEDIUM", "LOW"):
            return "LOW"
        return v.upper()


# ---------------------------------------------------------------------------
# Weighted score calculation
# ---------------------------------------------------------------------------

def _compute_weighted_scores(
    interview_id: int,
    jd_skills: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Return overall_score (0-100), primary_match, secondary_match, recommendation,
    and per-skill panelist averages keyed by skill_id."""

    # Two submission paths:
    #   - Magic-link feedback: saves overall_score (1-5), sub-scores are NULL
    #   - JWT PANELIST/ADMIN: saves technical/communication/problem_solving (1-10 each), overall_score NULL
    # Normalise both to 1-5 scale.
    score_rows = db.session.execute(
        sa.text(
            """
            SELECT skill_id,
                   AVG(
                       CASE
                           WHEN technical_score IS NOT NULL
                           THEN (technical_score + communication_score + problem_solving_score) / 6.0
                           ELSE overall_score * 1.0
                       END
                   ) AS avg_1_5
            FROM interview_scores
            WHERE interview_id = :iid
            GROUP BY skill_id
            """
        ),
        {"iid": interview_id},
    ).mappings().all()

    skill_avg: Dict[int, float] = {r["skill_id"]: float(r["avg_1_5"]) for r in score_rows}

    primary_avgs, secondary_avgs = [], []
    skill_id_map: Dict[int, str] = {}   # skill_id -> skill_type

    for skill in jd_skills:
        sid = skill["id"]
        stype = (skill.get("skill_type") or "").lower()
        skill_id_map[sid] = stype
        avg = skill_avg.get(sid)
        if avg is None:
            continue
        if stype == "primary":
            primary_avgs.append(avg)
        elif stype == "secondary":
            secondary_avgs.append(avg)
        # soft skills excluded from numeric score

    avg_primary = (sum(primary_avgs) / len(primary_avgs)) if primary_avgs else 0.0
    avg_secondary = (sum(secondary_avgs) / len(secondary_avgs)) if secondary_avgs else 0.0

    # overall_score = (avg_primary * 0.7 + avg_secondary * 0.3) * 20  => 0-100
    overall_score = (avg_primary * 0.7 + avg_secondary * 0.3) * 20

    primary_match = (avg_primary / 5.0) * 100
    secondary_match = (avg_secondary / 5.0) * 100

    if overall_score >= 85:
        recommendation = "STRONG_HIRE"
    elif overall_score >= 70:
        recommendation = "HIRE"
    elif overall_score >= 50:
        recommendation = "MAYBE"
    else:
        recommendation = "NO_HIRE"

    return {
        "overall_score": round(overall_score, 2),
        "primary_match": round(primary_match, 2),
        "secondary_match": round(secondary_match, 2),
        "recommendation": recommendation,
        "skill_avg": skill_avg,       # {skill_id: avg_1_5}
    }


# ---------------------------------------------------------------------------
# Prompt builder (Phase 2)
# ---------------------------------------------------------------------------

def _build_v2_prompt(
    candidate_skills: Any,
    jd_skills: List[Dict[str, Any]],
    panelist_scores: List[Dict[str, Any]],
    panel_assignments: List[Dict[str, Any]],
    transcript_text: Optional[str],
    computed: Dict[str, Any],
) -> str:
    primary = [s for s in jd_skills if (s.get("skill_type") or "").lower() == "primary"]
    secondary = [s for s in jd_skills if (s.get("skill_type") or "").lower() == "secondary"]
    soft = [s for s in jd_skills if (s.get("skill_type") or "").lower() == "soft"]

    def fmt_skills(lst: List[Dict]) -> str:
        parts = []
        for s in lst:
            sub = s.get("subtopics") or []
            if isinstance(sub, str):
                try:
                    sub = json.loads(sub)
                except Exception:
                    sub = []
            line = s["skill_name"]
            if sub:
                line += f" (subtopics: {', '.join(str(x) for x in sub)})"
            parts.append(f"  - {line}")
        return "\n".join(parts) or "  None"

    scores_text = []
    skill_avg = computed["skill_avg"]
    skill_name_map = {s["id"]: s["skill_name"] for s in jd_skills}

    for p in panelist_scores:
        pname = p.get("panelist_name", "Unknown")
        scores_text.append(f"  {pname}:")
        for sc in p.get("scores", []):
            sid = sc["skill_id"]
            sname = skill_name_map.get(sid, f"skill#{sid}")
            avg_15 = skill_avg.get(sid)
            avg_str = f"{avg_15:.1f}/5" if avg_15 is not None else "N/A"
            comments = sc.get("comments") or ""
            scores_text.append(f"    {sname}: {avg_str}" + (f" — {comments}" if comments else ""))

    pa_text = []
    coding_qa_all = []
    for pa in panel_assignments:
        pname = pa.get("panelist_name", "Unknown")
        rec = pa.get("recommendation") or "N/A"
        comments = pa.get("overall_comments") or ""
        pa_text.append(f"  {pname}: recommendation={rec}" + (f", notes: {comments}" if comments else ""))
        if pa.get("coding_qa"):
            try:
                cqa = pa["coding_qa"]
                if isinstance(cqa, str):
                    cqa = json.loads(cqa)
                if isinstance(cqa, list):
                    coding_qa_all.extend(cqa)
            except Exception:
                pass

    coding_text = "None"
    if coding_qa_all:
        coding_text = json.dumps(coding_qa_all, ensure_ascii=False, indent=2)[:3000]

    transcript_section = "No transcript available."
    if transcript_text:
        truncated = transcript_text[:_MAX_TRANSCRIPT_CHARS]
        if len(transcript_text) > _MAX_TRANSCRIPT_CHARS:
            truncated += "\n[...transcript truncated...]"
        transcript_section = truncated

    confidence = "HIGH" if transcript_text and len(transcript_text) > 500 else (
        "MEDIUM" if transcript_text else "LOW"
    )

    schema = textwrap.dedent("""\
    {
      "resume_summary": "2-3 sentence summary of candidate background from resume skills",
      "skill_scores": [
        {"skill_name": "", "skill_type": "primary|secondary|soft", "score": 1-5, "panelist_avg": 1-5, "ai_assessment": "one sentence"}
      ],
      "strengths": ["specific strength 1", "specific strength 2", "specific strength 3"],
      "concerns": ["specific concern 1", "specific concern 2"],
      "screening_question_analysis": [
        {"question": "question text", "panelist_notes": "what panelist wrote", "ai_assessment": "AI evaluation", "score": 1-5}
      ],
      "soft_skill_analysis": {
        "confidence": {"rating": "Bold & Confident|Confident|Average|Below Average", "observation": ""},
        "communication": {"rating": "Excellent|Good|Decent|Poor", "observation": ""},
        "pressure_handling": {"rating": "Excellent|Capable|Average|Poor", "observation": ""}
      },
      "analytical_skills": {
        "approach_attitude": {"rating": "Positive|Neutral|Negative", "observation": ""},
        "problem_solving": {"rating": "Problem Solver|Average|Weak", "observation": ""},
        "result_oriented": {"rating": "Highly Oriented|Passable|Not Oriented", "observation": ""}
      },
      "final_remarks": {
        "strengths_paragraph": "full paragraph",
        "conclusion": "2-3 sentence hiring conclusion"
      },
      "recommendation": "STRONG_HIRE|HIRE|MAYBE|NO_HIRE",
      "overall_score": 0-100,
      "confidence_level": "HIGH|MEDIUM|LOW"
    }""")

    return (
        "Evaluate this candidate interview and return structured JSON.\n\n"
        f"CANDIDATE RESUME SKILLS:\n{json.dumps(candidate_skills or [], ensure_ascii=False)}\n\n"
        f"JD PRIMARY SKILLS REQUIRED:\n{fmt_skills(primary)}\n\n"
        f"JD SECONDARY SKILLS REQUIRED:\n{fmt_skills(secondary)}\n\n"
        f"JD SOFT SKILLS REQUIRED:\n{fmt_skills(soft)}\n\n"
        f"PANELIST SCORES:\n{chr(10).join(scores_text) or '  No scores submitted.'}\n\n"
        f"PANELIST OVERALL COMMENTS:\n{chr(10).join(pa_text) or '  None.'}\n\n"
        f"CODING ASSESSMENT:\n{coding_text}\n\n"
        f"INTERVIEW TRANSCRIPT:\n{transcript_section}\n\n"
        f"COMPUTED SCORES:\n"
        f"- Overall Score: {computed['overall_score']}/100\n"
        f"- Primary Skills Match: {computed['primary_match']}%\n"
        f"- Secondary Skills Match: {computed['secondary_match']}%\n"
        f"- Computed Recommendation: {computed['recommendation']}\n"
        f"- Confidence Level (based on transcript): {confidence}\n\n"
        f"Return this exact JSON schema:\n{schema}"
    )


# ---------------------------------------------------------------------------
# DB persistence helpers
# ---------------------------------------------------------------------------

def _save_v2_score(
    interview_id: int,
    transcript_id: Optional[int],
    report_status: str,
    parsed: Optional[AIScoreResponseV2],
    raw_response: str,
    overall_score: float,
    primary_match: float,
    secondary_match: float,
    recommendation: str,
) -> None:
    generated_at = datetime.now(timezone.utc).replace(tzinfo=None)

    skill_breakdown = None
    ai_suggestion = None
    strengths = None
    concerns = None

    if parsed:
        skill_breakdown = [item.model_dump() for item in parsed.skill_scores]
        ai_suggestion = raw_response
        strengths = parsed.strengths
        concerns = parsed.concerns

    existing = db.session.execute(
        sa.text("SELECT id FROM ai_interview_scores WHERE interview_id = :iid LIMIT 1"),
        {"iid": interview_id},
    ).mappings().first()

    if existing:
        obj = db.session.get(AIInterviewScore, existing["id"])
        obj.transcript_id = transcript_id
        obj.overall_score = overall_score
        obj.skill_scores = skill_breakdown
        obj.strengths = strengths
        obj.concerns = concerns
        obj.recommendation = recommendation
        obj.ai_raw_response = raw_response
        obj.generated_at = generated_at
        obj.report_status = report_status
        obj.primary_match = primary_match
        obj.secondary_match = secondary_match
        obj.skill_breakdown = skill_breakdown
        obj.ai_suggestion = ai_suggestion
    else:
        obj = AIInterviewScore(
            interview_id=interview_id,
            transcript_id=transcript_id,
            overall_score=overall_score,
            skill_scores=skill_breakdown,
            strengths=strengths,
            concerns=concerns,
            recommendation=recommendation,
            ai_raw_response=raw_response,
            generated_at=generated_at,
            report_status=report_status,
            primary_match=primary_match,
            secondary_match=secondary_match,
            skill_breakdown=skill_breakdown,
            ai_suggestion=ai_suggestion,
        )
        db.session.add(obj)
    db.session.commit()


# ---------------------------------------------------------------------------
# Phase 2 — main entry point
# ---------------------------------------------------------------------------

def generate_ai_score(interview_id: int) -> Dict[str, Any]:
    """Full scoring engine: gathers all data, computes weighted scores, calls GPT-4o.

    Returns a dict with at minimum:
        report_status: 'GENERATED' | 'FAILED'
        error: <message>  (only on FAILED)
    """
    # Step 1: gather interview + candidate + JD + skills
    interview_row = db.session.execute(
        sa.text(
            """
            SELECT s.id, s.jd_id, s.candidate_id, s.status,
                   c.candidate_extracted_skills
            FROM interview_schedules s
            JOIN candidates c ON c.id = s.candidate_id
            WHERE s.id = :iid LIMIT 1
            """
        ),
        {"iid": interview_id},
    ).mappings().first()

    if not interview_row:
        return {"report_status": "FAILED", "error": "Interview not found"}

    jd_skills_rows = db.session.execute(
        sa.text(
            """
            SELECT id, skill_name, skill_type, subtopics
            FROM jd_skills WHERE jd_id = :jd_id
            """
        ),
        {"jd_id": interview_row["jd_id"]},
    ).mappings().all()
    jd_skills = [dict(r) for r in jd_skills_rows]

    # Step 2: check at least one score exists
    score_count = db.session.execute(
        sa.text("SELECT COUNT(*) AS cnt FROM interview_scores WHERE interview_id = :iid"),
        {"iid": interview_id},
    ).scalar()

    if not score_count:
        return {"report_status": "FAILED", "error": "No panelist scores found for this interview"}

    # Gather panelist scores grouped by panelist
    score_rows = db.session.execute(
        sa.text(
            """
            SELECT s.panelist_id, p.name AS panelist_name,
                   s.skill_id, s.technical_score, s.communication_score,
                   s.problem_solving_score, s.comments
            FROM interview_scores s
            JOIN panelists p ON p.id = s.panelist_id
            WHERE s.interview_id = :iid
            ORDER BY s.panelist_id, s.skill_id
            """
        ),
        {"iid": interview_id},
    ).mappings().all()

    panelist_scores: Dict[int, Dict] = {}
    for r in score_rows:
        pid = r["panelist_id"]
        if pid not in panelist_scores:
            panelist_scores[pid] = {"panelist_id": pid, "panelist_name": r["panelist_name"], "scores": []}
        panelist_scores[pid]["scores"].append(dict(r))

    # Gather panel_assignments (overall comments, recommendation, coding_qa)
    pa_rows = db.session.execute(
        sa.text(
            """
            SELECT pa.panelist_id, p.name AS panelist_name,
                   pa.overall_comments, pa.recommendation,
                   pa.coding_qa, pa.coding_score, pa.no_coding_round
            FROM panel_assignments pa
            JOIN panelists p ON p.id = pa.panelist_id
            WHERE pa.interview_id = :iid
            """
        ),
        {"iid": interview_id},
    ).mappings().all()
    panel_assignments = [dict(r) for r in pa_rows]

    # Fetch transcript (optional)
    transcript_row = db.session.execute(
        sa.text(
            """
            SELECT id, parsed_text, raw_text
            FROM interview_transcripts WHERE interview_id = :iid LIMIT 1
            """
        ),
        {"iid": interview_id},
    ).mappings().first()

    transcript_id = transcript_row["id"] if transcript_row else None
    transcript_text = None
    if transcript_row:
        transcript_text = transcript_row["parsed_text"] or transcript_row["raw_text"]

    # Candidate resume skills
    candidate_skills = interview_row["candidate_extracted_skills"]
    if isinstance(candidate_skills, str):
        try:
            candidate_skills = json.loads(candidate_skills)
        except Exception:
            candidate_skills = []

    # Step 2: compute weighted scores
    computed = _compute_weighted_scores(interview_id, jd_skills)

    # Step 3: build prompt + call GPT with retries
    client = OpenAI()
    user_prompt = _build_v2_prompt(
        candidate_skills=candidate_skills,
        jd_skills=jd_skills,
        panelist_scores=list(panelist_scores.values()),
        panel_assignments=panel_assignments,
        transcript_text=transcript_text,
        computed=computed,
    )

    delays = [1, 2, 4]
    last_raw = ""

    for attempt, delay in enumerate(delays, start=1):
        try:
            completion = client.chat.completions.create(
                model=_GPT_MODEL,
                temperature=0,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT_V2},
                    {"role": "user", "content": user_prompt},
                ],
            )
            content = completion.choices[0].message.content or "{}"
            last_raw = content
            parsed_dict = json.loads(content)
            validated = AIScoreResponseV2.model_validate(parsed_dict)

            # Step 5: store — use threshold-derived recommendation (not GPT's)
            _save_v2_score(
                interview_id=interview_id,
                transcript_id=transcript_id,
                report_status="GENERATED",
                parsed=validated,
                raw_response=content,
                overall_score=computed["overall_score"],
                primary_match=computed["primary_match"],
                secondary_match=computed["secondary_match"],
                recommendation=computed["recommendation"],   # threshold, not GPT
            )

            return {
                "report_status": "GENERATED",
                "overall_score": computed["overall_score"],
                "primary_match": computed["primary_match"],
                "secondary_match": computed["secondary_match"],
                "recommendation": computed["recommendation"],
                "confidence_level": validated.confidence_level,
                "strengths_count": len(validated.strengths),
                "concerns_count": len(validated.concerns),
            }

        except (ValidationError, ValueError, KeyError, TypeError) as exc:
            last_raw = str(exc)
        except Exception as exc:
            last_raw = str(exc)

        if attempt < len(delays):
            time.sleep(delay)

    # All retries failed
    _save_v2_score(
        interview_id=interview_id,
        transcript_id=transcript_id,
        report_status="FAILED",
        parsed=None,
        raw_response=last_raw,
        overall_score=computed["overall_score"],
        primary_match=computed["primary_match"],
        secondary_match=computed["secondary_match"],
        recommendation=computed["recommendation"],
    )
    return {"report_status": "FAILED", "error": "AI scoring failed after 3 retries"}


# ---------------------------------------------------------------------------
# Phase 1 — kept for backward compat (called by upload_transcript endpoint)
# ---------------------------------------------------------------------------

def _build_user_prompt(transcript_text: str, jd_skills: List[dict]) -> str:
    primary_skills = [
        {"skill_id": item.get("id"), "skill_name": item.get("skill_name")}
        for item in jd_skills
        if (item.get("skill_type") or "").lower() == "primary"
    ]
    secondary_skills = [
        {"skill_id": item.get("id"), "skill_name": item.get("skill_name")}
        for item in jd_skills
        if (item.get("skill_type") or "").lower() == "secondary"
    ]

    return (
        "Evaluate this interview transcript and score the candidate against JD skills.\n\n"
        "JD Skills:\n"
        f"Primary: {json.dumps(primary_skills, ensure_ascii=True)}\n"
        f"Secondary: {json.dumps(secondary_skills, ensure_ascii=True)}\n\n"
        "Transcript:\n"
        f"{transcript_text}\n\n"
        "Instructions:\n"
        "1. Score each listed skill on a 1-10 scale.\n"
        "2. Provide concise reasoning for each skill score.\n"
        "3. Identify top 3 strengths.\n"
        "4. Identify top 3 concerns.\n"
        "5. Provide an overall recommendation: STRONG_HIRE, HIRE, MAYBE, or NO_HIRE.\n"
        "6. Return ONLY valid JSON with this exact structure:\n"
        "{\n"
        "  \"overall_score\": float,\n"
        "  \"skill_scores\": [\n"
        "    {\"skill_id\": int, \"skill_name\": str, \"score\": float, \"reasoning\": str}\n"
        "  ],\n"
        "  \"strengths\": [\"string\", \"string\", \"string\"],\n"
        "  \"concerns\": [\"string\", \"string\", \"string\"],\n"
        "  \"recommendation\": \"STRONG_HIRE|HIRE|MAYBE|NO_HIRE\"\n"
        "}\n"
    )


def _save_ai_score(
    interview_id: int,
    transcript_id: int,
    report_status: str,
    parsed: Optional[InterviewScoreResponse],
    raw_response: str,
) -> None:
    generated_at = datetime.now(timezone.utc).replace(tzinfo=None)

    overall_score_val = parsed.overall_score if parsed else None
    skill_scores_val = json.dumps([item.model_dump() for item in parsed.skill_scores], ensure_ascii=True) if parsed else None
    strengths_val = json.dumps(parsed.strengths, ensure_ascii=True) if parsed else None
    concerns_val = json.dumps(parsed.concerns, ensure_ascii=True) if parsed else None
    recommendation_val = parsed.recommendation.value if parsed else None

    existing = db.session.execute(
        sa.text("SELECT id FROM ai_interview_scores WHERE interview_id = :iid LIMIT 1"),
        {"iid": interview_id},
    ).mappings().first()

    if existing:
        obj = db.session.get(AIInterviewScore, existing["id"])
        obj.transcript_id = transcript_id
        obj.overall_score = overall_score_val
        obj.skill_scores = skill_scores_val
        obj.strengths = strengths_val
        obj.concerns = concerns_val
        obj.recommendation = recommendation_val
        obj.ai_raw_response = raw_response
        obj.generated_at = generated_at
        obj.report_status = report_status
    else:
        obj = AIInterviewScore(
            interview_id=interview_id,
            transcript_id=transcript_id,
            overall_score=overall_score_val,
            skill_scores=skill_scores_val,
            strengths=strengths_val,
            concerns=concerns_val,
            recommendation=recommendation_val,
            ai_raw_response=raw_response,
            generated_at=generated_at,
            report_status=report_status,
        )
        db.session.add(obj)
    db.session.commit()


def generate_interview_score(interview_id: int, transcript_text: str, jd_skills: List[dict]) -> dict:
    """Phase 1 scorer — called from upload_transcript endpoint."""
    transcript_row = db.session.execute(
        sa.text(
            "SELECT id FROM interview_transcripts WHERE interview_id = :iid LIMIT 1"
        ),
        {"iid": interview_id},
    ).mappings().first()

    if transcript_row is None:
        return {"report_status": "FAILED", "error": "Transcript not found"}

    transcript_id = transcript_row["id"]
    client = OpenAI()
    user_prompt = _build_user_prompt(transcript_text, jd_skills)

    delays = [1, 2, 4]
    last_raw = ""

    for attempt, delay in enumerate(delays, start=1):
        try:
            completion = client.chat.completions.create(
                model=_GPT_MODEL,
                temperature=0,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT_V1},
                    {"role": "user", "content": user_prompt},
                ],
            )
            content = completion.choices[0].message.content or "{}"
            last_raw = content
            parsed_dict = json.loads(content)
            validated = InterviewScoreResponse.model_validate(parsed_dict)

            validated.strengths = validated.strengths[:3]
            validated.concerns = validated.concerns[:3]

            _save_ai_score(
                interview_id=interview_id,
                transcript_id=transcript_id,
                report_status="GENERATED",
                parsed=validated,
                raw_response=content,
            )

            return {
                "report_status": "GENERATED",
                "overall_score": validated.overall_score,
                "recommendation": validated.recommendation.value,
                "skill_scores_count": len(validated.skill_scores),
            }
        except (ValidationError, ValueError, KeyError, TypeError) as exc:
            last_raw = str(exc)
        except Exception as exc:
            last_raw = str(exc)

        if attempt < len(delays):
            time.sleep(delay)

    _save_ai_score(
        interview_id=interview_id,
        transcript_id=transcript_id,
        report_status="FAILED",
        parsed=None,
        raw_response=last_raw,
    )
    return {"report_status": "FAILED", "error": "AI scoring failed after retries"}
