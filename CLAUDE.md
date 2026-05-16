# IAAS — Interview as a Service: Complete Technical Reference

> **Purpose of this file:** Permanent memory for every Claude Code session on this project.  
> Read this before touching any code. Update it whenever architecture, migrations, or modules change.

---

## 1. Project Name & Purpose

**Name:** IAAS — Interview as a Service (built by Adroit / Meeden Labs)  
**Purpose:** End-to-end recruitment and interview management platform. Manages job descriptions (with AI skill extraction), candidates (with AI resume parsing), interview scheduling (Teams integration), panelist scoring, QC validation, and a client-facing results portal.

**Core Flow:**
```
Client → JD Created → Recruiter Assigned → Candidates Added (AI resume parse)
→ Interview Scheduled (Teams event + emails) → Panelist Scores Submitted (1–5 stars)
→ Transcript Uploaded → AI Score Generated → QC Validates → CLIENT views results
```

---

## 2. Tech Stack (Exact Versions)

### Backend
| Package | Version |
|---|---|
| Python | 3.13 |
| Flask | 3.0.3 |
| SQLAlchemy | 3.1.1 |
| Flask-Migrate (Alembic) | 4.0.7 |
| Flask-JWT-Extended | 4.6.0 |
| Marshmallow | 3.22.0 |
| passlib | 1.7.4 |
| cryptography | 42.0.8 |
| Flask-Limiter | 3.8.0 |
| PyMuPDF | 1.26.0–1.28 |
| python-docx | 1.1.2 |
| openai | latest |
| sendgrid | latest |
| openpyxl | 3.1.5 |
| pydantic | 2.11.4 |
| pytz | 2024.1 |
| requests | 2.32.3 |
| python-dotenv | 1.0.1 |

### Frontend
| Package | Version |
|---|---|
| React | 18.3.1 |
| React Router DOM | 6.26.2 |
| Vite | 5.4.2 |
| Zustand | 5.0.2 |
| Axios | 1.7.9 |
| Tailwind CSS | 3.4.19 |
| jsPDF | 4.2.1 |
| jspdf-autotable | 5.0.7 |
| XLSX | 0.18.5 |

### Infrastructure
- Database: MySQL 8.0
- Reverse Proxy: Nginx Proxy Manager (NPM routes everything to `iaas-frontend:3000`; `/api` routing is handled by nginx **inside** the frontend container — no NPM custom location needed)
- Container Registry: GitHub Container Registry (ghcr.io)
- Deployment Target: DigitalOcean droplet `64.227.185.32` (`/opt/iaas`)
- Test URL: `https://testiaas.meedenlabs.com` (current deployment from `main`)
- Production URL: `https://iaas.meedenlabs.com` (future `production` branch)

---

## 3. Database Tables

| Table | Purpose |
|---|---|
| `users` | Platform users with roles (no PANELIST login — panelists are in separate table) |
| `clients` | Client organizations (the companies that hire) |
| `revoked_tokens` | Logout/token invalidation store |
| `panelists` | Standalone panelist registry — no login, ADMIN-managed |
| `job_descriptions` | JDs with AI extraction metadata and status |
| `jd_skills` | Skills extracted from JDs (primary/secondary/soft) |
| `candidates` | Candidates linked to a JD, with resume and skills |
| `interview_schedules` | Scheduled interviews with Teams meeting data |
| `panel_assignments` | Many-to-many: panelists ↔ interviews (FK → panelists.id) |
| `panelist_availability` | Panelist time slots (availability calendar) |
| `interview_scores` | Panelist-submitted scores per JD skill (FK → panelists.id) |
| `interview_transcripts` | Uploaded interview transcripts (file or raw text) |
| `ai_interview_scores` | AI-generated scores from transcript analysis |
| `jd_recruiter_assignments` | Recruiters assigned to specific JDs |
| `jd_panelist_assignments` | Legacy pre-assignment table (backend only, no frontend UI) |
| `feedback_validations` | QC review records for AI scores |
| `operator_client_assignments` | Many-to-many: operators ↔ clients |

### Key Column Details

**`panelists`**: id, panel_id (`PAN-XXXX` auto-assigned), name, skill (TEXT), email (unique), phone, location, created_at, created_by (FK→users, SET NULL)

**`panel_assignments`**: interview_id (PK, FK→interview_schedules), panelist_id (PK, FK→**panelists**.id), created_at, feedback_token (UUID, unique), token_valid_from, token_expires_at, token_used (BOOL), token_used_at, overall_comments (TEXT), recommendation (STRONG_HIRE/HIRE/MAYBE/NO_HIRE), no_coding_round (BOOL), coding_qa (JSON), coding_score (SmallInt 1–5), coding_comments (TEXT)

**`users`**: id, full_name, email (unique), password_hash, role (ENUM), client_id (FK→clients), reports_to (FK→users self-join), is_active, created_at

**`job_descriptions`**: id, client_id, title, job_code (unique, format `JD-{YEAR}-{ID:04d}`), raw_text, file_url, calibration_url, rate_scale, skills_extraction_hash, skills_extracted_at, status (DRAFT/ACTIVE/CLOSED), created_by

**`candidates`**: id, client_id, jd_id, full_name, email, phone, status (APPLIED/SHORTLISTED/INTERVIEWED/SELECTED/NOT_SELECTED), status_updated_at, candidate_extracted_skills (JSON), resume_url, resume_filename, resume_uploaded_at, ai_extracted  
 — **Unique constraint:** (email, jd_id)

**`interview_schedules`**: id, candidate_id, jd_id, scheduled_at, duration_minutes, mode, meeting_link, timezone, external_event_id (Teams), teams_meeting_id, status (SCHEDULED/IN_PROGRESS/COMPLETED/CANCELLED/ABSENT), outcome (SELECTED/NOT_SELECTED — required when status→COMPLETED)

**`interview_scores`**: interview_id, panelist_id (FK→**panelists**.id), skill_id, overall_score (1–5), comments, submitted_at

**`ai_interview_scores`**: id, interview_id (unique), transcript_id, overall_score (DECIMAL 5,2), skill_scores (JSON), strengths (JSON), concerns (JSON), recommendation (STRONG_HIRE/HIRE/MAYBE/NO_HIRE), ai_raw_response, report_status (PENDING/GENERATED/FAILED)

**`feedback_validations`**: id, interview_id (unique), validated_by, status (PENDING/VALIDATED), final_recommendation, qc_notes, skill_overrides (JSON), approved (BOOL)

---

## 4. API Endpoints by Blueprint

All endpoints are prefixed `/api/`.

### `auth` — `/api/auth`
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | /login | No | Rate: 5/min. Sets JWT cookies |
| POST | /refresh | Refresh cookie | Renews access token |
| POST | /logout | Yes | Revokes token, clears cookies |
| GET | /me | Yes | Returns current user |

### `users` — `/api/users`
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | / | Yes | List users (role/client filtered) |
| GET | /by-client/{client_id} | Yes | Users in a client |
| POST | / | Yes | Create user (role hierarchy enforced) |
| PUT | /{user_id} | Yes | Update user |
| DELETE | /{user_id} | Yes | Delete user |

### `clients` — `/api/clients`
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | / | Yes | List with metrics |
| GET | /{client_id} | Yes | Client detail + metrics |
| POST | / | ADMIN/M_RECRUITER | Create client |
| PUT | /{client_id} | ADMIN | Update client |
| POST | /{client_id}/assign-user | ADMIN | Assign user to client |
| DELETE | /{client_id} | ADMIN | Delete (blocked if has JDs/candidates) |

### `jds` — `/api/jds`
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | / | Yes | Create JD (status=DRAFT) |
| GET | / | Yes | List (RECRUITER sees assigned only) |
| GET | /{jd_id} | Yes | JD detail |
| PUT | /{jd_id}/status | Yes | DRAFT→ACTIVE→CLOSED |
| DELETE | /{jd_id} | ADMIN | Soft-close JD |
| POST | /{jd_id}/upload | Yes | Upload PDF/DOCX → extract raw_text |
| GET | /{jd_id}/download | Yes | Download JD file |
| POST | /{jd_id}/extract-skills | Yes | Rate: 20/hr. AI skill extraction (cached) |
| GET | /{jd_id}/skills | Yes | List skills |
| POST | /{jd_id}/skills | Yes | Add skill manually |
| PUT | /{jd_id}/skills/{skill_id} | Yes | Update skill |
| DELETE | /{jd_id}/skills/{skill_id} | Yes | Delete skill |
| POST | /assign-recruiters | Yes | Bulk-assign RECRUITERs to JD |

### `candidates` — `/api/candidates`
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | / | Yes | List (filters: client_id, jd_id, status) |
| POST | / | Yes | Create single (validates cooling period) |
| POST | /bulk-upload-resumes | Yes | Max 20 files, returns preview before save |
| PUT | /{candidate_id} | Yes | Update candidate |
| DELETE | /{candidate_id} | Admin/M_REC/SR_REC | Delete candidate |
| POST | /{candidate_id}/resume | Yes | Upload resume file |
| POST | /{candidate_id}/extract-resume | Yes | AI extract from uploaded resume |
| GET | /{candidate_id}/resume | Yes | Download resume |

### `interviews` — `/api/interviews`
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | / | Yes | Schedule (creates Teams event + sends emails) |
| GET | / | Yes | List interviews |
| GET | /{interview_id} | Yes | Detail with panelists |
| PUT | /{interview_id}/status | Yes | Update status |
| DELETE | /{interview_id} | Yes | Cancel (calls Teams cancellation) |
| POST | /{interview_id}/panelists | Yes | Assign/update panelists |
| GET | /{interview_id}/panelists | Yes | List assigned panelists |

### `panelists` — `/api/panelists`
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | / | ADMIN/OPERATOR/M_REC/SR_REC | List all panelists (supports ?search=) |
| POST | / | ADMIN | Create single panelist |
| POST | /bulk | ADMIN | Create multiple (JSON array, max 100) |
| POST | /excel-upload | ADMIN | Upload .xlsx file (max 100MB) |
| PUT | /{id} | ADMIN | Update panelist |
| DELETE | /{id} | ADMIN | Delete panelist |

### `feedback` — `/api/feedback`
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | /{token} | None (public) | Load feedback form data. Rate: 30/hr. Returns 409 if used, 410 if expired, 425 if not yet open |
| POST | /{token} | None (public) | Submit feedback. Rate: 5/hr. Scores 1–5, recommendation required |

### `scoring` — `/api/scoring`
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | /interviews/{id}/scores | PANELIST/ADMIN | Submit per-skill scores (1–5) |
| GET | /interviews/{id}/scores | Yes | Get all panelist scores |
| POST | /interviews/{id}/transcript | Yes | Upload transcript → triggers AI scoring |
| GET | /interviews/{id}/ai-score | Yes | Get AI score (full ai_suggestion JSON) |
| POST | /interviews/{id}/fetch-transcript | ADMIN/M_RECRUITER/SR_RECRUITER/OPERATOR | Fetch Teams VTT transcript → upsert |
| POST | /interviews/{id}/generate-score | ADMIN/M_RECRUITER/SR_RECRUITER/QC | M4 Phase 2 full AI scoring engine |

### `qc` — `/api/qc`
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | /dashboard | QC/ADMIN/Recruiters | Summary stats |
| GET | /interviews | QC/ADMIN/Recruiters | List with ai_score_status, feedback_count, transcript_available, report_distributed |
| GET | /interviews/{id}/review | QC/ADMIN | Full review: candidate, JD, scores, AI |
| PUT | /interviews/{id}/review | QC/ADMIN | Validate; approved=True triggers distribution |
| POST | /interviews/{id}/distribute | QC/ADMIN | Manual report re-send to recruiter hierarchy |

### `panelist_assignments` — `/api/panelist-assignments`
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | / | Yes | List (with filters) |
| POST | / | Yes | Create single assignment |
| POST | /bulk-upload | Yes | CSV upload |
| DELETE | /{id} | Yes | Delete assignment |

> **Note:** `panelist_assignments` blueprint is backend-only. The frontend route and sidebar item have been removed. The `jd_panelist_assignments` table is retained but unused in the UI.

### `client_portal` — `/api/client-portal`
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | /results | CLIENT | Approved interview results for client |
| GET | /candidates/{id}/result | CLIENT | Detailed result with AI/QC feedback |

---

## 5. User Roles & Permissions

| Role | Rank | Key Permissions |
|---|---|---|
| CLIENT | 1 | View own approved results only |
| PANELIST | 2 | Users table role (legacy) — actual panelists are in `panelists` table with no login |
| RECRUITER | 3 | View assigned JDs/candidates, create candidates, upload resumes |
| SR_RECRUITER | 4 | + create JDs, manage recruiters in their client |
| M_RECRUITER | 5 | + manage SR_RECRUITERs, full pipeline oversight |
| QC | 6 | Review all interviews, validate AI scores, approve for client |
| ADMIN | 7 | Full system access, manages panelist registry |
| OPERATOR | — | Client-scoped: schedule interviews, view candidates/JDs for their client |

**Feature access matrix (condensed):**
- User Management: ADMIN only
- Panelist Management: ADMIN only (create/update/delete in `panelists` table)
- Create JD: ADMIN, M_RECRUITER, SR_RECRUITER
- Create Candidates: ADMIN, M_RECRUITER, SR_RECRUITER, RECRUITER (assigned JDs only)
- Delete Candidates: ADMIN, M_RECRUITER, SR_RECRUITER
- Schedule Interviews: ADMIN, M_RECRUITER, SR_RECRUITER, OPERATOR
- Submit Feedback: Anyone with a valid feedback token (public URL)
- QC Validate: QC only
- Client Portal: CLIENT only (post-QC approval)

---

## 6. Frontend Pages

| Route | Page | Purpose |
|---|---|---|
| `/login` | Login | Email/password auth |
| `/dashboard` | Dashboard | Role-based metrics; CLIENT redirects to `/client-dashboard` |
| `/client-dashboard` | ClientDashboard | CLIENT-only approved results portal |
| `/candidates` | Candidates | CRUD, bulk resume upload, AI extraction, download |
| `/jd` | JDManagement | Create JDs, upload files, extract skills |
| `/skill-extraction/:jdId` | SkillExtraction | Extract/view/edit skills for a specific JD |
| `/interviews` | Interviews | Schedule, manage panelists, status updates. Panelist picker loads from `/api/panelists` |
| `/panelists` | Panelists | ADMIN only. Panelist registry with table (Sl.No, Panel ID, Name, Skill, Email, Number, Location, Date). Add single/multiple/Excel upload |
| `/feedback/:token` | FeedbackForm | Public token-based form. 5-star rating per skill. Coding round Q&A. No auth required |
| `/qc` | QCReview | QC validation interface |
| `/report` | ScoreReport | Interview reports with PDF/Excel export |
| `/users` | Users | User management (ADMIN/M_RECRUITER/SR_RECRUITER) |
| `/slots` | PanelistSlots | Panelist availability slot management |

> `/panelist-assignments` route and sidebar item have been **removed**. The page file `PanelistAssignments.jsx` still exists but is not routed.

**State management:** Zustand store at `src/store/authStore.js`  
**API layer:** `src/api/` — authApi, candidatesApi, jdApi, interviewsApi, scoringApi, qcApi, usersApi, clientsApi, clientPortalApi, panelistAssignmentsApi, **panelistsApi** (new)  
**Axios instance:** `src/api/axiosInstance.js` — `baseURL: '/'` (relative, works for any domain), withCredentials=true, auto X-CSRF-TOKEN header, auto-logout on 401

---

## 7. Alembic Migrations (Chronological)

| Migration ID | Description |
|---|---|
| `9c5f28bfc9cb` | Initial tables: `users`, `clients` |
| `8e914d99322b` | Add `job_descriptions`, `jd_skills` |
| `c3f9f0a9f2b1` | Add `candidates` with unique(email, jd_id) |
| `bc23de45fa67` | Add `interview_schedules`, `panel_assignments`, `panelist_availability` |
| `cd34ef56ab78` | Add `interview_scores`, `interview_transcripts`, `ai_interview_scores` |
| `5da7109026e0` | Add `job_code` (unique) to job_descriptions |
| `a901d58758fc` | Add `revoked_tokens` for logout |
| `ab12cd34ef56` | Add `resume_url`, `resume_filename` to candidates |
| `f1a2b3c4d5e6` | Add OPERATOR to users role ENUM |
| `19c9c2308873` | Add `soft` to jd_skill type ENUM |
| `k2l3m4n5o6p7` | Add `skills_extraction_hash`, `skills_extracted_at` to JD |
| `g7b8c9d0e1f2` | Add `status_updated_at` to candidates (cooling period) |
| `8f1g2h3i4j5k` | Add `calibration_url`, `rate_scale` to JD |
| `h8i9j0k1l2m3` | Add `resume_uploaded_at` to candidates |
| `i9j0k1l2m3n4` | Merge candidate migration heads |
| `j1k2l3m4n5o6` | Add `external_event_id`, `teams_meeting_id` to interviews |
| `l3m4n5o6p7q8` | Create `jd_panelist_assignments` |
| `h8c9d0e1f2g3` | Add `candidate_extracted_skills` (JSON) to candidates |
| `f6a7b8c9d0e1` | Add `feedback_validations` for QC workflow |
| `e5f6g7h8i9j0` | Enforce recruiter-client integrity constraints |
| `m4n5o6p7q8r9` | Create `operator_client_assignments` table |
| `n5o6p7q8r9s0` | Enforce unique(email, jd_id) on candidates |
| `o1p2q3r4s5t6` | Add ABSENT to interview status enum + `outcome` column |
| `p2q3r4s5t6u7` | Drop `assigned_by` from `panel_assignments` |
| `q3r4s5t6u7v8` | Add `feedback_token`, `token_expires_at`, `token_used`, `token_used_at` to panel_assignments |
| `r4s5t6u7v8w9` | Feedback production fixes (overall_comments, recommendation on panel_assignments) |
| `s5t6u7v8w9x0` | Create `panelists` table; rewire FKs on panel_assignments, interview_scores, jd_panelist_assignments → panelists.id |
| `t6u7v8w9x0y1` | Add coding fields to panel_assignments (no_coding_round, coding_qa, coding_score, coding_comments) |
| `u7v8w9x0y1z2` | Add `token_valid_from` to panel_assignments |
| `v2w3x4y5z6a7` | M4 Phase 1: add distribution columns to ai_interview_scores & feedback_validations; add source, fetched_at, vtt_raw, parsed_text to interview_transcripts |
| `w3x4y5z6a7b8` | M4 Phase 2: add primary_match, secondary_match, skill_breakdown, ai_suggestion to ai_interview_scores |
| `x4y5z6a7b8c9` | Allow NULL transcript_id in ai_interview_scores (transcriptless scoring support) |

**Current migration head:** `x4y5z6a7b8c9`

---

## 8. Module Completion Status

| Module | Status | What was Built |
|---|---|---|
| **M1 — Foundation** | ✅ Complete | Users, clients, auth (JWT+cookies), RBAC, user hierarchy |
| **M2 — JD & Candidates** | ✅ Complete | JD CRUD + file upload, AI skill extraction (cached), candidate CRUD + cooling period, bulk resume upload + AI parse |
| **M3 — Interviews & Scoring** | ✅ Complete | Interview scheduling + Teams + emails (HTML with attachments), standalone panelist registry, per-interview panelist assignment, feedback form (5-star), token-based feedback submission, transcript upload, AI scoring, QC validation, client portal, operator role |
| **M4 — Reports & Analytics** | 🔄 In Progress | Score reports with PDF/Excel export exist; Phase 1 (Teams transcript fetch, distribution columns) complete; Phase 2 (full AI scoring engine with weighted averages, GPT narrative, generate-score endpoint) complete; analytics dashboard pending |

**Current branch:** `panelist-module`

---

## 9. Environment Variables

All loaded via `python-dotenv` from `iaas-backend/.env`.

```env
# Database
DATABASE_URL=mysql://root:root@localhost:3306/iaas

# Auth
JWT_SECRET_KEY=replace-with-secure-random-value
JWT_COOKIE_SECURE=False                  # True in production

# Flask
FLASK_ENV=development
FLASK_APP=wsgi.py

# Email (SendGrid)
SENDGRID_API_KEY=SG.xxxx
SENDGRID_FROM_EMAIL=interview@meedenlabs.com

# AI
OPENAI_API_KEY=sk-xxxx

# Microsoft Teams (Graph API)
TEAMS_TENANT_ID=xxxx
TEAMS_CLIENT_ID=xxxx
TEAMS_CLIENT_SECRET=xxxx
TEAMS_ORGANIZER_USER_ID=xxxx
TEAMS_ORGANIZER_EMAIL=Interview@meedenlabs.com

# App URLs (used for email links and resume attachment URL construction)
APP_BASE_URL=https://testiaas.meedenlabs.com   # testiaas for test, iaas.meedenlabs.com for prod
CORS_ORIGINS=https://testiaas.meedenlabs.com,https://iaas.meedenlabs.com,http://localhost:5173

# MySQL (Docker)
MYSQL_ROOT_PASSWORD=xxxx
MYSQL_USER=xxxx
MYSQL_PASSWORD=xxxx

# Nginx Proxy Manager DB
NPM_DB_ROOT_PASSWORD=xxxx
NPM_DB_PASSWORD=xxxx
```

---

## 10. Docker & Deployment

### Docker Compose Services

| Service | Image | Port | Notes |
|---|---|---|---|
| `iaas-backend` | `ghcr.io/gowtham-0903/iaas-backend` | Internal | Mounts `/app/uploads` volume |
| `iaas-frontend` | `ghcr.io/gowtham-0903/iaas-frontend` | Internal | nginx inside container proxies `/api` → `iaas-backend:5001` |
| `iaas-db` | `mysql:8.0` | 3306 | Healthcheck: `mysqladmin ping` |
| `phpmyadmin` | `phpmyadmin/phpmyadmin` | Internal | DB admin UI |
| `nginx-proxy-manager` | nginx-proxy-manager | 80, 443, 81 | SSL termination + reverse proxy |
| `npm-db` | `mysql:8.0` | Internal | Separate DB for NPM |

**Volumes:** `mysql-data`, `resume-uploads`, `npm-data`, `npm-letsencrypt`, `npm-mysql-data`  
**Network:** `iaas-net` (bridge)

### NPM Proxy Host Setup

NPM forwards all traffic to `iaas-frontend:3000`. **No custom `/api` location needed** in NPM — the nginx config inside the frontend container handles `/api` → `iaas-backend:5001` internally.

| Domain | Forward To | SSL |
|---|---|---|
| `testiaas.meedenlabs.com` | `iaas-frontend:3000` | Let's Encrypt |
| `iaas.meedenlabs.com` | `iaas-frontend:3000` | Let's Encrypt (future) |

### CI/CD Pipeline (`.github/workflows/deploy.yml`)

**Trigger:** Push to `main`

1. **Build job:** Login to ghcr.io → Build & push backend + frontend images (`:latest` + `:{sha}`)
2. **Deploy job:** SSH to DigitalOcean → `cd /opt/iaas` → `docker compose pull` → `docker compose up -d --remove-orphans` → `docker image prune -f` → wait 15s → `docker exec iaas-backend flask db upgrade`

### Local Development

```bash
# Backend
cd iaas-backend
pip install -r requirements.txt
flask db upgrade
python seed.py          # Creates admin@meedenlabs.com / admin@#1234
flask run --host 127.0.0.1 --port 5001

# Frontend
cd iaas-frontend
npm install
npm run dev             # http://localhost:5173
```

---

## 11. Feature Phases

### Phase 1 — Foundation (M1) ✅
- User model with 8 roles + RBAC
- Client model + user-client associations
- JWT auth with HTTPOnly cookies + CSRF protection
- Role hierarchy enforcement
- Password hashing (pbkdf2_sha256), token revocation on logout

### Phase 2 — JD & Candidates (M2) ✅
- JD CRUD with status lifecycle (DRAFT → ACTIVE → CLOSED)
- JD file upload (PDF/DOCX) with text extraction
- AI skill extraction via GPT-4o — hash-based caching
- Manual skill management per JD (primary/secondary/soft with subtopics)
- Candidate CRUD with unique(email, jd_id) + 30-day cooling period
- Single resume upload + AI extraction
- Bulk resume upload (max 20 files) → preview before save

### Phase 3 — Interviews, Scoring, QC, Operator (M3) ✅
- Interview scheduling with timezone support + Teams meeting creation
- **Panelist registry** (`panelists` table, no login): ADMIN-managed, Panel ID auto-assigned (`PAN-XXXX`), Excel upload (.xlsx), single/bulk manual add
- Per-interview panelist assignment from panelists table
- **Token-based feedback form** (public URL, no auth): 5-star rating per skill, coding round Q&A, overall comments + recommendation
- Feedback token: UUID in panel_assignments, valid 48h after scheduled_at, single-use
- **HTML emails** (SendGrid): candidate, panelists, additional recipients all get rich HTML. Panelist/additional emails include resume + JD as file attachments (max 5MB each)
- Interview transcript upload + AI scoring via GPT-4o
- QC validation workflow → unlocks CLIENT portal
- CLIENT portal (approved results only)
- OPERATOR role for client-side scheduling

### Phase 4 — Reports & Analytics (M4 — Partial) 🔄
- Score report page with PDF export (jsPDF) and Excel export (XLSX)
- Full analytics dashboard pending

---

## 12. Pending Items & Next Steps

- [ ] M4 analytics dashboard (pipeline trends, recruiter utilization, panelist performance)
- [ ] Candidate status bulk update
- [ ] Interview rescheduling flow (update Teams event)
- [ ] Panelist availability conflict detection during scheduling
- [ ] Score normalization / weighted average calculation
- [ ] Admin role-change UI (currently no PUT /users/{id}/role endpoint)
- [ ] Pagination on list endpoints (currently returns all records)
- [ ] Client-scoped OPERATOR creation (currently only ADMIN can create OPERATOR)
- [ ] Audit log / activity trail
- [ ] Frontend test suite (only backend tests exist)
- [ ] Set up `production` branch + deploy to `iaas.meedenlabs.com`

---

## 13. Key Business Rules

### 30-Day Cooling Period
- When a candidate's status is set to `NOT_SELECTED` for a JD, they cannot reapply to the same JD for 30 days.
- Tracked via `status_updated_at` on candidates.

### Panelist Registry
- Panelists are **not** platform users — they live in the `panelists` table with no login credentials.
- Panel ID is auto-assigned as `PAN-{id:04d}` (e.g. `PAN-0001`) on creation using flush-then-assign.
- Excel upload uses columns: Name, Skill, Email ID, Number, Location (case-insensitive, Name + Email ID required).
- Panelists can be assigned to any interview regardless of client or JD.

### Feedback Token Lifecycle
- A UUID feedback token is generated per `panel_assignment` when an interview is created.
- `token_valid_from` = interview `scheduled_at` (panelist can only submit after interview starts).
- `token_expires_at` = `scheduled_at + 7 days`.
- Token is single-use — `token_used = True` after submission.
- Public URL: `https://{APP_BASE_URL}/feedback/{token}` (no auth required).

### Feedback Score Scale
- All skill scores and coding score are **1–5** (not 1–10).
- Backend validates `1 <= score <= 5` in both `feedback.py` and `scoring.py`.
- Frontend uses 5-star SVG rating inline with skill name (no numeric grid).
- Comment minimums: primary skill = 1000 chars, secondary/soft = 250 chars, overall = 500 chars, coding assessment = 1000 chars.

### Email Attachments
- Panelist invitation emails and additional-recipient notification emails attach:
  1. Candidate resume (from `uploads/resumes/...`), max 5MB
  2. JD file (from `uploads/jd_files/...`), max 5MB
- If a file is missing or over 5MB, it is silently skipped (email still sends).
- Resume download button in email points to `{APP_BASE_URL}/api/candidates/{id}/resume`.

### JD Extraction Idempotency
- Skill extraction is cached via `skills_extraction_hash` (MD5 of raw_text).
- Rate limited to 20 requests/hour.

### Teams Integration
- Creates a Teams meeting via Microsoft Graph API (OAuth2 client credentials).
- Meeting attendees = candidate + all assigned panelists.
- `external_event_id` + `teams_meeting_id` stored for cancellation.
- Graceful degradation if Teams env vars missing.

### Bulk Resume Upload Rules
- Max 20 files, PDF/DOCX only, 2MB per file.
- Returns preview before any DB records are created.

### Job Code Format
- Auto-assigned: `JD-{YEAR}-{ID:04d}` (e.g. `JD-2026-0001`)

### Interview Outcome on Completion
- COMPLETED requires `outcome` (SELECTED or NOT_SELECTED) → auto-updates candidate status.
- ABSENT does not require outcome.

### QC Approval Gate
- Results visible in CLIENT portal only after `approved=True` on feedback_validation.

### File Storage Paths
- Resumes: `uploads/resumes/{candidate_id}_{timestamp}_{filename}`
- JD files: `uploads/jd_files/{jd_id}_{timestamp}_{filename}`
- Transcripts: `uploads/transcripts/{interview_id}_{timestamp}_{filename}`

---

## 14. File Structure Overview

```
iaas/
├── CLAUDE.md
├── README.md
├── docker-compose.yml
├── .github/workflows/deploy.yml
│
├── iaas-backend/
│   ├── wsgi.py
│   ├── seed.py
│   ├── requirements.txt
│   ├── .env
│   ├── app/
│   │   ├── __init__.py                ← Flask app factory, blueprint registration
│   │   ├── config.py
│   │   ├── blueprints/
│   │   │   ├── __init__.py
│   │   │   ├── auth.py
│   │   │   ├── users.py
│   │   │   ├── clients.py
│   │   │   ├── job_descriptions.py
│   │   │   ├── candidates.py
│   │   │   ├── interviews.py          ← Panelists from panelists table (not users)
│   │   │   ├── panelists.py           ← NEW: Panelist registry CRUD + Excel upload
│   │   │   ├── feedback.py            ← NEW: Public token-based feedback form
│   │   │   ├── scoring.py
│   │   │   ├── qc.py
│   │   │   ├── panelist_assignments.py ← Backend only (no frontend route)
│   │   │   └── client_portal.py
│   │   ├── models/
│   │   │   ├── user.py
│   │   │   ├── client.py
│   │   │   ├── panelist.py            ← NEW: Panelist model (standalone table)
│   │   │   ├── job_description.py
│   │   │   ├── candidate.py
│   │   │   ├── interview_schedule.py  ← PanelAssignment FK → panelists.id
│   │   │   ├── interview_scoring.py   ← InterviewScore FK → panelists.id
│   │   │   ├── jd_panelist_assignment.py
│   │   │   ├── operator_client_assignment.py
│   │   │   └── feedback_validation.py
│   │   ├── services/
│   │   │   ├── file_parser.py
│   │   │   ├── skill_extractor.py
│   │   │   ├── ai_scorer.py
│   │   │   ├── email_service.py       ← HTML emails; panelist/additional get resume+JD attachments
│   │   │   └── teams_service.py
│   ├── migrations/versions/           ← 29 migration files (head: u7v8w9x0y1z2)
│   └── uploads/
│       ├── resumes/
│       ├── jd_files/
│       └── transcripts/
│
└── iaas-frontend/
    └── src/
        ├── App.jsx                    ← /panelist-assignments route REMOVED
        ├── api/
        │   ├── axiosInstance.js       ← baseURL: '/' (relative, domain-agnostic)
        │   ├── panelistsApi.js        ← NEW
        │   └── (other api files)
        ├── pages/
        │   ├── Panelists.jsx          ← NEW: /panelists (ADMIN only)
        │   ├── FeedbackForm.jsx       ← 5-star rating, public /feedback/:token
        │   ├── PanelistAssignments.jsx ← File exists but NOT routed
        │   └── (other pages)
        └── components/
            └── Sidebar.jsx            ← Panelist Assignments item REMOVED
```

---

## 15. Security Architecture

| Layer | Mechanism |
|---|---|
| Auth tokens | JWT in HTTPOnly cookies (access 15min, refresh 7 days) |
| CSRF | X-CSRF-TOKEN header required on all mutating requests |
| Password storage | pbkdf2_sha256 via passlib |
| Rate limiting | Login: 5/min; skill extraction: 20/hr; feedback GET: 30/hr; feedback POST: 5/hr |
| Token revocation | RevokedToken table checked on every request |
| File path safety | Downloads validated against `uploads/` directory to prevent traversal |
| File validation | Extension whitelist (.pdf/.docx/.txt) + size limits (2MB resumes, 10MB JD, 5MB transcripts) |
| Email attachment limit | 5MB per file; skipped silently if exceeded |
| Feedback tokens | UUID, single-use, time-windowed (valid_from → expires_at) |

---

## 16. Default Seeded User

| Field | Value |
|---|---|
| Email | `admin@meedenlabs.com` |
| Password | `admin@#1234` |
| Role | ADMIN |

> Run `python seed.py` from `iaas-backend/` after first migration.

---

## Project History

### Module 1 — Auth and Foundation (Complete)
- JWT auth with cookie-based tokens (not localStorage)
- Roles: ADMIN, M_RECRUITER, SR_RECRUITER, RECRUITER, PANELIST, QC, CLIENT, OPERATOR
- User hierarchy with reports_to foreign key
- Docker Compose: frontend, backend, MySQL, Nginx Proxy Manager
- GitHub Actions CI/CD deploying to DigitalOcean droplet
- Images at ghcr.io/gowtham-0903/

### Module 2 — JD and AI Extraction (Complete)
- Client management with metrics
- JD upload PDF/DOCX via PyMuPDF and python-docx
- GPT-4o skill extraction with Pydantic validation and 3x retry
- JD extraction idempotent via SHA256 hash of raw_text
- JD-Recruiter assignment via jd_recruiter_assignments
- Skill types: primary, secondary, soft

### Module 3 — Candidates, Interviews, Panelists, Feedback (Complete)
- Single candidate creation + resume upload (PDF/DOCX, 2MB) + AI extraction
- Bulk resume upload: up to 20 files
- 30-day cooling period for NOT_SELECTED candidates
- Teams integration via Microsoft Graph API (virtual-only interviews)
- **Panelist module**: Standalone `panelists` table (no user login). ADMIN-managed via UI. Panel ID auto-assigned PAN-XXXX. Excel upload (.xlsx), single/bulk manual add
- Panelists chosen from panelists table for any interview (no JD pre-assignment required)
- **Feedback system**: Token per panel_assignment. Public URL. 5-star rating per skill. Coding round Q&A. Token valid from interview start, expires 7 days after
- **HTML emails**: All emails (candidate, panelist, additional) use rich HTML templates. Panelist + additional emails attach resume PDF and JD PDF
- Interview transcript upload + AI scoring via GPT-4o
- QC validation workflow → unlocks CLIENT portal
- OPERATOR role for client-side scheduling

### Module 4 — Reports (Partial)
- Score report with PDF/Excel export
- Full analytics dashboard pending

### Teams Integration Details
- Organizer: Interview@meedenlabs.com
- Azure app permissions: Calendars.ReadWrite, OnlineMeetings.ReadWrite.All
- Application access policy required via PowerShell
- Token cached in-process with expiry buffer

### Key Business Rules
- Cooling period: 30 days after NOT_SELECTED for same email+JD
- JD extraction: idempotent, skips AI if hash unchanged
- Interview mode: virtual only (Teams)
- Max panelists: 3 per interview
- Panelists: chosen from panelists table (no JD pre-assignment gate)
- Score scale: 1–5 (was 1–10, changed in panelist-module branch)
- Candidate status flow: APPLIED → SHORTLISTED → INTERVIEWED → SELECTED/NOT_SELECTED
- Resume size: 2MB per file upload; 5MB limit for email attachment

### Deployment
- Test: `testiaas.meedenlabs.com` → droplet `64.227.185.32` (current main branch)
- Production: `iaas.meedenlabs.com` (future `production` branch)
- NPM: No custom `/api` location — nginx inside frontend container handles the proxy
- Migrations current head: `w3x4y5z6a7b8`

### Post-Merge Fixes (on main before panelist-module branch)
- Interview ABSENT status + outcome column
- operator_client_assignments table
- Unique(email, jd_id) constraint on candidates
- Dropped assigned_by from panel_assignments
- HH:MM time format handling in panelist availability endpoint
- CI/CD fixed: GITHUB_TOKEN used instead of GHCR_PAT
- SkillExtraction.jsx page restored

### Changes on panelist-module branch
- Panelists extracted from users table → standalone `panelists` table (5 new migrations)
- New blueprints: `panelists.py`, `feedback.py`
- `panel_assignments` and `interview_scores` FKs rewired from users.id → panelists.id
- Score scale changed 1–10 → 1–5 across feedback.py, FeedbackForm.jsx
- FeedbackForm: 5-star SVG rating inline with skill name (replaced numeric grid)
- Email service: panelist + additional recipient emails use HTML (same blue theme as candidate), with resume + JD file attachments
- Panelist Assignments removed from frontend (sidebar + route); backend retained
- New test file: `tests/test_panelists.py` (10 tests)
- axiosInstance.js baseURL changed from hardcoded `http://127.0.0.1:5001` → `'/'`
- APP_BASE_URL env var added for email resume links

---

## Governance & Validation Rules

### Automatic Triggers
Claude Code must automatically run pre-push validation when any of these phrases are used:
- "ready to push" / "push to main"
- "create PR" / "merge to main"
- "validate before push"
- "commit and push to main"

### Feature Branch Rule
On feature branches — lightweight only: analyze changed files, quick syntax/import check, no full repo scan, no CLAUDE.md regeneration.

### Main Branch Rule
On push or merge to main — full governance: run complete validation checklist from governance.md skill, return APPROVED or BLOCKED, auto-update CLAUDE.md affected sections only.

### Skills Active for This Project
- `.claude/skills/governance.md` — pre-push validation
- `.claude/skills/backend-flask.md` — Flask/backend rules
- `.claude/skills/frontend-react.md` — React/frontend rules
- `.claude/skills/database-migrations.md` — migration safety
- `.claude/skills/security.md` — security checklist
- `.claude/skills/deployment.md` — CI/CD and Docker rules

---

*Last updated: 2026-05-14 | Branch: panelist-module | M4 Phase 1+2+3+4 complete*
