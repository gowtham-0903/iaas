import json
import os
import re
import time

from openai import OpenAI


SYSTEM_PROMPT = (
    "You are a technical recruiter expert. Extract skills from job descriptions and return ONLY valid JSON. "
    "Use the same input text to produce the same normalized skills whenever possible."
)


def _normalize_jd_text(jd_text: str) -> str:
    text = jd_text.lower()
    text = re.sub(r'[•·▪▸\-–—|/\\]', ' ', text)
    text = re.sub(r'[\(\)\[\]\{\}]', ' ', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def _build_user_prompt(jd_text: str) -> str:
    return (
        "You are an expert technical recruiter extracting skills from a job description.\n\n"
        "The job description may be structured, unstructured, minimal, informal, broken English, "
        "or in table/bullet/score-based format. Extract skills from whatever format is present — adapt to the content.\n\n"
        "EXTRACTION RULES:\n"
        "- Extract ALL technologies, tools, frameworks, concepts, and platforms explicitly mentioned.\n"
        "- If a specific tool is named (AWS, Terraform, Keycloak, Power BI, SAP Basis), extract it exactly.\n"
        "- If only a concept is mentioned (CI/CD, Infrastructure as Code), extract the concept.\n"
        "- Do NOT group. 'AWS, Azure, GCP' = three separate skills, not 'Cloud Services'.\n"
        "- Do NOT invent skills not present in the JD text.\n"
        "- For minimal JDs (2-5 lines), extract only what is stated — do not pad.\n"
        "- For score-based JDs ('BigQuery 4 out of 5'), extract the skill name only.\n"
        "- The JD may be extremely unstructured or informal — extract skills regardless of grammar or formatting.\n"
        "- If the same skill appears written differently (e.g. 'power bi', 'PowerBI', 'power-bi'), "
        "extract it once as the canonical name (e.g. 'Power BI').\n"
        "- Deduplicate. Normalize casing (e.g. 'kubernetes' → 'Kubernetes').\n\n"
        "CLASSIFICATION:\n"
        "- primary_skills: explicitly required, must-have, core to the role, repeated across JD\n"
        "- secondary_skills: nice-to-have, bonus, preferred, certifications\n"
        "- soft_skills: communication, leadership, teamwork, problem-solving, mentoring\n\n"
        "IMPORTANCE:\n"
        "- Use 'must-have' for primary skills\n"
        "- Use 'nice-to-have' for secondary skills\n"
        "- Use 'must-have' for explicitly required soft skills\n\n"
        "SUBTOPICS:\n"
        "- Only add subtopics if they are explicitly mentioned in the JD text.\n"
        "- Do NOT invent subtopics.\n"
        "- Example: AWS with S3, Glue, RDS mentioned → subtopics: ['S3', 'Glue', 'RDS']\n\n"
        "OUTPUT (strict JSON only, no markdown, no explanation):\n"
        "{\n"
        '  "primary_skills": [\n'
        '    { "skill_name": "Python", "importance_level": "must-have", "subtopics": ["Scripting", "Automation"] }\n'
        "  ],\n"
        '  "secondary_skills": [\n'
        '    { "skill_name": "Octopus Deploy", "importance_level": "nice-to-have", "subtopics": [] }\n'
        "  ],\n"
        '  "soft_skills": [\n'
        '    { "skill_name": "Leadership", "importance_level": "must-have", "subtopics": [] }\n'
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
    "cloud",
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
    jd_lower = _normalize_jd_text(jd_text)

    KNOWN_EXPANSIONS = {
        "ci/cd": ["continuous integration", "continuous deployment", "ci/cd", "cicd"],
        "iac": ["infrastructure as code", "infrastructure-as-code", "iac"],
        "sre": ["site reliability", "sre"],
        "iam": ["identity and access", "iam"],
        "etl": ["extract, transform", "etl"],
        "api": ["api", "rest", "restful"],
        "sql": ["sql", "query", "database"],
        "orm": ["sqlalchemy", "hibernate", "orm", "sequelize"],
        "ml": ["machine learning", "ml", "model training"],
        "nlp": ["natural language", "nlp", "text processing"],
    }

    def is_supported(skill_name):
        skill = skill_name.lower().strip()
        if not skill:
            return False

        # Direct match
        if skill in jd_lower:
            return True

        # Normalized variations
        variations = [
            skill.replace("/", " "),
            skill.replace("-", " "),
            skill.replace(".", " "),
            skill.replace(" ", ""),
            skill.replace(".", ""),
            re.sub(r'[^a-z0-9 ]', '', skill),
        ]
        if any(v in jd_lower for v in variations):
            return True

        # Multi-word: all meaningful words must appear in JD
        words = [w for w in skill.split() if len(w) > 2]
        if len(words) >= 2 and all(word in jd_lower for word in words):
            return True

        # Single meaningful word
        if len(words) == 1 and words[0] in jd_lower:
            return True

        # Acronym expansion
        if skill in KNOWN_EXPANSIONS:
            return any(exp in jd_lower for exp in KNOWN_EXPANSIONS[skill])

        return False

    def filter_list(skills):
        return [s for s in skills if is_supported(s["skill_name"])]

    result["primary_skills"] = filter_list(result.get("primary_skills", []))
    result["secondary_skills"] = filter_list(result.get("secondary_skills", []))
    result["soft_skills"] = filter_list(result.get("soft_skills", []))
    return result


def extract_skills_from_text(jd_text: str) -> dict:
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY", ""))
    normalized_jd_text = _normalize_jd_text(jd_text)
    user_prompt = _build_user_prompt(normalized_jd_text)

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
                filtered_unrelated = _remove_unrelated_skills(normalized, jd_text)
                return _filter_generic_skills(filtered_unrelated)
        except Exception:
            pass

        if attempt < len(delays):
            time.sleep(delay)

    raise Exception("AI extraction failed after 3 attempts")