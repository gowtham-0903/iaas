import json
import os
import time

from openai import OpenAI


SYSTEM_PROMPT = (
    "You are a technical recruiter expert. Extract skills from job descriptions and return ONLY valid JSON. "
    "Use the same input text to produce the same normalized skills whenever possible."
)


def _build_user_prompt(jd_text: str) -> str:
    return (
        "You are an expert technical recruiter and data extractor.\n\n"
        "Extract ALL relevant skills from the job description.\n\n"
        "STRICT RULES:\n"
        "- Extract skills as ATOMIC units (no grouping).\n"
        "- DO NOT group multiple concepts under one skill.\n"
        "- Extract tools, technologies, frameworks, and concepts separately.\n"
        "- Prefer SPECIFIC skills over generic ones.\n"
        "- Avoid vague categories like 'DevOps', 'Cloud', 'Automation' unless explicitly required.\n"
        "- NEVER return generic categories like 'DevOps', 'Cloud', 'Cloud Services', 'Automation' if more specific tools or technologies are present.\n"
        "- If such terms appear, you MUST break them down into specific tools or concepts.\n"
        "- Example:\n"
        "  - Instead of 'Cloud Services' -> return 'AWS', 'Azure', 'GCP'\n"
        "  - Instead of 'DevOps' -> return 'CI/CD', 'Infrastructure as Code', 'Monitoring'\n"
        "- Generic categories are allowed ONLY if no specific tools or technologies are mentioned in the job description.\n"
        "- If a specific tool is mentioned (e.g., Terraform), extract it as a skill.\n"
        "- If a concept is critical (e.g., CI/CD, Infrastructure as Code), extract it as a skill.\n"
        "- Only include skills clearly supported by the job description.\n"
        "- Keep output deduplicated and normalized.\n\n"
        "CLASSIFICATION RULES:\n"
        "- primary_skills = must-have, critical, core responsibilities\n"
        "- secondary_skills = optional, nice-to-have\n"
        "- soft_skills = communication, leadership, teamwork, etc.\n\n"
        "OUTPUT FORMAT (STRICT JSON ONLY):\n"
        "{\n"
        '  "primary_skills": [\n'
        '    { "skill_name": "Python", "importance_level": "must-have", "subtopics": ["Django", "FastAPI"] }\n'
        "  ],\n"
        '  "secondary_skills": [\n'
        '    { "skill_name": "Docker", "importance_level": "nice-to-have", "subtopics": [] }\n'
        "  ],\n"
        '  "soft_skills": [\n'
        '    { "skill_name": "Leadership", "importance_level": "must-have", "subtopics": ["Mentoring"] }\n'
        "  ]\n"
        "}\n\n"
        f"Job Description:\n{jd_text}"
    )


def _validate_result(payload):
    if not isinstance(payload, dict):
        return False

    for key in ["primary_skills", "secondary_skills"]:
        if key not in payload or not isinstance(payload[key], list):
            return False

    return True


def _normalize_result(payload):
    def normalize_item(item):
        return {
            "skill_name": (item.get("skill_name") or "").strip(),
            "importance_level": (item.get("importance_level") or "").strip() or None,
            "subtopics": sorted(
                {
                    str(subtopic).strip()
                    for subtopic in (item.get("subtopics") or [])
                    if str(subtopic).strip()
                }
            ),
        }

    normalized = {
        "primary_skills": [normalize_item(item) for item in payload.get("primary_skills") or []],
        "secondary_skills": [normalize_item(item) for item in payload.get("secondary_skills") or []],
        "soft_skills": [normalize_item(item) for item in payload.get("soft_skills") or []],
    }

    normalized["primary_skills"] = sorted(normalized["primary_skills"], key=lambda item: item["skill_name"].lower())
    normalized["secondary_skills"] = sorted(normalized["secondary_skills"], key=lambda item: item["skill_name"].lower())
    normalized["soft_skills"] = sorted(normalized["soft_skills"], key=lambda item: item["skill_name"].lower())
    return normalized


BANNED_GENERIC_SKILLS = {
    "devops",
    "cloud",
    "cloud services",
    "automation",
    "infrastructure",
}


def _filter_generic_skills(result):
    def filter_list(skills):
        return [
            skill
            for skill in skills
            if skill["skill_name"].lower() not in BANNED_GENERIC_SKILLS
        ]

    result["primary_skills"] = filter_list(result.get("primary_skills", []))
    result["secondary_skills"] = filter_list(result.get("secondary_skills", []))
    return result


def _remove_unrelated_skills(result, jd_text):
    jd_lower = jd_text.lower()

    def is_supported(skill_name):
        skill = skill_name.lower()

        # Direct match
        if skill in jd_lower:
            return True

        # Allow small variations (basic normalization)
        variations = [
            skill.replace("/", " "),
            skill.replace("-", " "),
        ]

        return any(variant in jd_lower for variant in variations)

    def filter_list(skills):
        return [
            skill
            for skill in skills
            if is_supported(skill["skill_name"])
        ]

    result["primary_skills"] = filter_list(result.get("primary_skills", []))
    result["secondary_skills"] = filter_list(result.get("secondary_skills", []))
    result["soft_skills"] = filter_list(result.get("soft_skills", []))

    return result


def extract_skills_from_text(jd_text: str) -> dict:
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY", ""))
    user_prompt = _build_user_prompt(jd_text)

    delays = [1, 2, 4]
    for attempt, delay in enumerate(delays, start=1):
        try:
            completion = client.chat.completions.create(
                model="gpt-4o",
                temperature=0,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
            )

            content = completion.choices[0].message.content or "{}"
            parsed = json.loads(content)
            if _validate_result(parsed):
                normalized = _normalize_result(parsed)
                filtered = _filter_generic_skills(normalized)
                return _remove_unrelated_skills(filtered, jd_text)
        except Exception:
            pass

        if attempt < len(delays):
            time.sleep(delay)

    raise Exception("AI extraction failed after 3 attempts")