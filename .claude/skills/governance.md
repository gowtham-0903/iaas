# IAAS Governance & Pre-Push Validation Skill

## When This Skill Activates
- User says "ready to push" or "push to main"
- User says "create PR" or "merge to main"
- User says "validate before push"
- User completes a feature and asks to commit
- Any push targeting main branch

## When to Use Lightweight Mode Only
- Working on feature branches
- Local development changes
- Single file edits
- Do NOT run full repo scan on feature branch work
- Do NOT regenerate CLAUDE.md on feature branch pushes

---

## PRE-PUSH VALIDATION CHECKLIST

When push to main is requested, run these checks in order:

### 1. Detect What Changed
- Run: git diff --name-only main..HEAD
- Identify: which blueprints, models, migrations,
  frontend pages, services, workflows changed
- Only analyze changed files and their direct dependencies

### 2. API Validation
- Every new endpoint has matching test in tests/
- Every endpoint has auth check or is explicitly public
- Every endpoint returns correct HTTP status codes
- No endpoint exposes raw exception messages
- Public endpoints are explicitly documented in CLAUDE.md

### 3. Database Validation
- Every new model has a matching Alembic migration
- Migration has upgrade() and downgrade() functions
- No nullable column added to existing table without default
- No destructive changes (DROP TABLE, DROP COLUMN)
- Foreign key references exist in DB and in models
- Migration runs in correct order after current head
- Current head matches CLAUDE.md Section 7 last entry

### 4. Security Validation
- No hardcoded secrets or API keys in any committed file
- No new public endpoint without explicit justification
- RBAC decorator present on all protected routes
- File uploads have extension whitelist and size limit
- No raw str(err) returned to API caller
- No new env var without entry in .env.example
- Cooling period enforced on candidate re-apply
- Token-based public endpoints expire correctly

### 5. Frontend/Backend Compatibility
- API response fields match what frontend expects
- New routes added to App.jsx with correct wrapper
  (ProtectedRoute for auth, plain Route for public)
- New API functions added to correct src/api/ file
- Axios calls use correct endpoint paths
- New pages added to Sidebar.jsx if they need navigation

### 6. Test Coverage Validation
For every new feature check:
- Does a test file exist for the new blueprint?
- Are happy path tests written?
- Are error and edge case tests written?
- Are RBAC/role restriction tests written?
- Are validation tests written (400, 404, 409, 410)?
- Are external service mock tests written?
If any missing:
- List exactly which test functions need to be written
- Block push until tests are added

### 7. CI/CD Validation
- deploy.yml syntax is valid YAML
- No || true hiding failures
- test job runs before build-and-push job
- build-and-push job runs before deploy job
- Required secrets documented: DO_DROPLET_IP,
  DO_SSH_PRIVATE_KEY, GITHUB_TOKEN
- flask db upgrade runs after container restart
- set -e present in SSH deploy script

### 8. AI Workflow Validation
- All OpenAI calls have 3x retry with exponential backoff
- All OpenAI responses validated with Pydantic
- Fallback exists if AI call fails (manual entry or error msg)
- No AI failure causes 500 error to user
- OpenAI rate limit (20/hr on extraction) enforced

### 9. Environment Variable Check
- Any new env vars added to .env.example
- Any new env vars documented in CLAUDE.md Section 9
- No new required env var without graceful fallback in dev

### 10. IAAS-Specific Business Rule Validation
- Cooling period: 30 days enforced on candidate create + update
- JD extraction: hash checked before calling GPT-4o
- Interview creation: Teams event creation is atomic
- Feedback tokens: UUID, expire 48hrs after interview time
- Feedback tokens: marked used after single submission
- Max 3 panelists per interview enforced
- Job code format: JD-{YEAR}-{ID:04d}
- Candidate unique constraint: (email, jd_id)
- QC approval required before CLIENT portal shows result
- OPERATOR scoped to assigned clients only

---

## REGRESSION VALIDATION

Before approving main push, verify these workflows
are not broken by the changes:

- Auth: login → JWT → protected route → logout → token revoked
- Recruiter: JD upload → skill extract → candidate add → bulk upload
- Interview: schedule → Teams event → email → feedback token generated
- Panelist: click feedback link → form loads → submit → token used
- Scoring: feedback submit → AI score → QC validate → approve
- Client: QC approve → client views result in portal
- Docker: docker-compose up → migrations → seed user exists
- CI/CD: push → tests pass → build → deploy → db upgrade

---

## FINAL OUTPUT FORMAT

After running all checks output exactly this:

=== IAAS PRE-PUSH VALIDATION REPORT ===

Branch: [branch name]
Target: main
Changed Files: [count and list]

ARCHITECTURE REVIEW
[what changed, what it impacts, dependencies affected]

REGRESSION SUMMARY
[which workflows affected, which are confirmed safe]

TEST COVERAGE SUMMARY
✅ Covered: [list of tested scenarios]
❌ Missing: [exact test function names needed]

MIGRATION SAFETY SUMMARY
[migration status, head check, reversibility, risks]

SECURITY VALIDATION SUMMARY
[each security check result — pass or fail with detail]

DEPLOYMENT READINESS SUMMARY
[CI/CD check, env vars, Docker, secrets]

VERDICT: APPROVED ✅
or
VERDICT: BLOCKED ❌
Reason: [exact reason]
Required before push: [numbered list of what must be fixed]

---

## CLAUDE.MD AUTO-UPDATE (main branch only)

After successful push or merge to main:
- Read current CLAUDE.md
- Identify only sections affected by the changes
- Update only those sections:
  * New API endpoints → add to Section 4
  * New migrations → add to Section 7 in chronological order
  * New env vars → add to Section 9
  * Module status changes → update Section 8
  * New business rules → add to Section 13
  * New pages → add to Section 6
  * New tables → add to Section 3
  * New files → add to Section 14
- Append to Project History with date and what changed
- Update "Last updated" footer with today's date and branch
- Do NOT rewrite sections that did not change
- Do NOT change formatting of untouched sections
- Commit the CLAUDE.md update with message:
  "docs: sync CLAUDE.md after merge [YYYY-MM-DD]"
