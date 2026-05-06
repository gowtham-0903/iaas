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
→ Interview Scheduled (Teams event + emails) → Panelist Scores Submitted
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
| pydantic | 2.11.4 |
| pytz | 2024.1 |
| openpyxl | 3.1.5 |
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
- Reverse Proxy: Nginx Proxy Manager
- Container Registry: GitHub Container Registry (ghcr.io)
- Deployment Target: DigitalOcean droplet (`/opt/iaas`)

---

## 3. Database Tables

| Table | Purpose |
|---|---|
| `users` | All platform users with roles and client mapping |
| `clients` | Client organizations (the companies that hire) |
| `revoked_tokens` | Logout/token invalidation store |
| `job_descriptions` | JDs with AI extraction metadata and status |
| `jd_skills` | Skills extracted from JDs (primary/secondary/soft) |
| `candidates` | Candidates linked to a JD, with resume and skills |
| `interview_schedules` | Scheduled interviews with Teams meeting data |
| `panel_assignments` | Many-to-many: panelists ↔ interviews |
| `panelist_availability` | Panelist time slots (availability calendar) |
| `interview_scores` | Panelist-submitted scores per JD skill |
| `interview_transcripts` | Uploaded interview transcripts (file or raw text) |
| `ai_interview_scores` | AI-generated scores from transcript analysis |
| `jd_recruiter_assignments` | Recruiters assigned to specific JDs |
| `jd_panelist_assignments` | Panelists assigned to specific JDs (pre-assignment) |
| `feedback_validations` | QC review records for AI scores |

### Key Column Details

**`users`**: id, full_name, email (unique), password_hash, role (ENUM), client_id (FK→clients), reports_to (FK→users self-join), is_active, created_at  
**`job_descriptions`**: id, client_id, title, job_code (unique, format `JD-{YEAR}-{ID:04d}`), raw_text, file_url, calibration_url, rate_scale, skills_extraction_hash, skills_extracted_at, status (DRAFT/ACTIVE/CLOSED), created_by  
**`candidates`**: id, client_id, jd_id, full_name, email, phone, status (APPLIED/SHORTLISTED/INTERVIEWED/SELECTED/NOT_SELECTED), status_updated_at, candidate_extracted_skills (JSON), resume_url, resume_filename, resume_uploaded_at, ai_extracted  
 — **Unique constraint:** (email, jd_id)  
**`interview_schedules`**: id, candidate_id, jd_id, scheduled_at, duration_minutes, mode, meeting_link, timezone, external_event_id (Teams), teams_meeting_id, status (SCHEDULED/IN_PROGRESS/COMPLETED/CANCELLED)  
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

### `scoring` — `/api/scoring`
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | /interviews/{id}/scores | PANELIST/ADMIN | Submit per-skill scores (1–10) |
| GET | /interviews/{id}/scores | Yes | Get all panelist scores |
| POST | /interviews/{id}/transcript | Yes | Upload transcript → triggers AI scoring |
| GET | /interviews/{id}/ai-score | Yes | Get AI score |

### `qc` — `/api/qc`
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | /dashboard | QC | List interviews with AI scores |
| GET | /interviews/{id}/review | QC | Full review: candidate, JD, scores, AI |
| POST | /interviews/{id}/validate | QC | Validate with recommendation/overrides |
| GET | /reports | QC | QC validation reports |

### `panelist_assignments` — `/api/panelist-assignments`
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | / | Yes | List (with filters) |
| POST | / | Yes | Create single assignment |
| POST | /bulk-upload | Yes | CSV upload (panelist_email, jd_code, client_name) |
| DELETE | /{id} | Yes | Delete assignment |

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
| PANELIST | 2 | View assigned interviews, submit scores, manage availability |
| RECRUITER | 3 | View assigned JDs/candidates, create candidates, upload resumes |
| SR_RECRUITER | 4 | + create JDs, manage recruiters in their client |
| M_RECRUITER | 5 | + manage SR_RECRUITERs, full pipeline oversight |
| QC | 6 | Review all interviews, validate AI scores, approve for client |
| ADMIN | 7 | Full system access |
| OPERATOR | — | Client-scoped: schedule interviews, view candidates/JDs for their client |

**Role creation hierarchy:**
- M_RECRUITER can create SR_RECRUITER and RECRUITER
- SR_RECRUITER can create RECRUITER
- Cross-client manager assignment is blocked
- `reports_to` manager must belong to same client

**Feature access matrix (condensed):**
- User Management: ADMIN only
- Create JD: ADMIN, M_RECRUITER, SR_RECRUITER
- Create Candidates: ADMIN, M_RECRUITER, SR_RECRUITER, RECRUITER (assigned JDs only)
- Delete Candidates: ADMIN, M_RECRUITER, SR_RECRUITER
- Schedule Interviews: ADMIN, M_RECRUITER, SR_RECRUITER, OPERATOR
- Submit Scores: PANELIST (assigned), ADMIN (override)
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
| `/skill-extraction` | SkillExtractionHub | Hub listing all JDs for skill extraction |
| `/skill-extraction/:jdId` | SkillExtraction | Extract/view/edit skills for a specific JD |
| `/interviews` | Interviews | Schedule, manage panelists, status updates |
| `/feedback` | Scoring | Panelist score form (PANELIST) or feedback viewer |
| `/qc` | QCReview | QC validation interface |
| `/report` | ScoreReport | Interview reports with PDF/Excel export |
| `/users` | Users | User management (ADMIN/M_RECRUITER/SR_RECRUITER) |
| `/panelist-assignments` | PanelistAssignments | Bulk CSV upload, manage panelist-JD assignments |
| `/slots` | PanelistSlots | Panelist availability slot management |

**State management:** Zustand store at `src/store/authStore.js`  
**API layer:** `src/api/` — one file per resource (authApi, candidatesApi, jdApi, interviewsApi, scoringApi, qcApi, usersApi, clientsApi, clientPortalApi, panelistAssignmentsApi)  
**Axios instance:** `src/api/axiosInstance.js` — base URL `http://127.0.0.1:5001`, withCredentials=true, auto X-CSRF-TOKEN header, auto-logout on 401

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
| `k2l3m4n5o6p7` | Add `skills_extraction_hash`, `skills_extracted_at` to JD (extraction idempotency) |
| `g7b8c9d0e1f2` | Add `status_updated_at` to candidates (cooling period) |
| `8f1g2h3i4j5k` | Add `calibration_url`, `rate_scale` to JD |
| `h8i9j0k1l2m3` | Add `resume_uploaded_at` (DATETIME TZ) to candidates |
| `i9j0k1l2m3n4` | Merge candidate migration heads |
| `j1k2l3m4n5o6` | Add `external_event_id`, `teams_meeting_id` to interviews |
| `l3m4n5o6p7q8` | Create `jd_panelist_assignments` |
| `h8c9d0e1f2g3` | Add `candidate_extracted_skills` (JSON) to candidates |
| `f6a7b8c9d0e1` | Add `feedback_validations` for QC workflow |
| `e5f6g7h8i9j0` | Enforce recruiter-client integrity constraints |

---

## 8. Module Completion Status

| Module | Status | What was Built |
|---|---|---|
| **M1 — Foundation** | ✅ Complete | Users, clients, auth (JWT+cookies), RBAC, user hierarchy |
| **M2 — JD & Candidates** | ✅ Complete | JD CRUD + file upload, AI skill extraction (cached), candidate CRUD + cooling period, bulk resume upload + AI parse |
| **M3 — Interviews & Scoring** | ✅ Complete | Interview scheduling + Teams + emails, panelist assignments (pre-assignment + per-interview), panelist availability, scoring per skill, transcript upload, AI scoring via GPT-4o, QC validation workflow, client portal, operator role |
| **M4 — Reports & Analytics** | 🔄 In Progress | Score reports with PDF/Excel export exist; full analytics dashboard, trend charts, utilization reports pending |

**Current branch:** `feature/module-3-complete`

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
SENDGRID_FROM_EMAIL=noreply@yourdomain.com

# AI
OPENAI_API_KEY=sk-xxxx

# Microsoft Teams (Graph API)
TEAMS_TENANT_ID=xxxx
TEAMS_CLIENT_ID=xxxx
TEAMS_CLIENT_SECRET=xxxx
TEAMS_ORGANIZER_USER_ID=xxxx            # User ID of meeting organizer account

# CORS
CORS_ORIGINS=http://localhost:5173

# MySQL (Docker)
MYSQL_ROOT_PASSWORD=xxxx
MYSQL_USER=xxxx
MYSQL_PASSWORD=xxxx

# Nginx Proxy Manager DB
NPM_DB_ROOT_PASSWORD=xxxx
NPM_DB_PASSWORD=xxxx
```

Frontend base URL: hardcoded in `iaas-frontend/src/api/axiosInstance.js` → `http://127.0.0.1:5001` (dev). Update for production.

---

## 10. Docker & Deployment

### Docker Compose Services

| Service | Image | Port | Notes |
|---|---|---|---|
| `iaas-backend` | `ghcr.io/gowtham-0903/iaas-backend` | Internal | Mounts `/app/uploads` volume |
| `iaas-frontend` | `ghcr.io/gowtham-0903/iaas-frontend` | Internal | Served via nginx-proxy-manager |
| `iaas-db` | `mysql:8.0` | 3306 | Healthcheck: `mysqladmin ping` |
| `phpmyadmin` | `phpmyadmin/phpmyadmin` | 3306 | DB admin UI |
| `nginx-proxy-manager` | nginx-proxy-manager | 80, 443, 81 | SSL termination + reverse proxy |
| `npm-db` | `mysql:8.0` | Internal | Separate DB for nginx-proxy-manager |

**Volumes:** `mysql-data`, `resume-uploads`, `npm-data`, `npm-letsencrypt`, `npm-mysql-data`  
**Network:** `iaas-net` (bridge)

### CI/CD Pipeline (`.github/workflows/deploy.yml`)

**Trigger:** Push to `main`

1. **Build job:** Login to ghcr.io → Build & push backend image (`:latest` + `:{sha}`) → Build & push frontend image
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

### Phase 1 — Foundation (M1)
- User model with 8 roles + RBAC
- Client model + user-client associations
- JWT auth with HTTPOnly cookies + CSRF protection
- Role hierarchy enforcement (who can create whom)
- Password hashing (pbkdf2_sha256), strength validation
- Rate limiting on login (5/min)
- Token revocation on logout

### Phase 2 — JD & Candidates (M2)
- JD CRUD with status lifecycle (DRAFT → ACTIVE → CLOSED)
- JD file upload (PDF/DOCX) with text extraction (PyMuPDF + python-docx)
- AI skill extraction via GPT-4o — hash-based caching (no re-extraction if JD unchanged)
- Manual skill management per JD (primary/secondary/soft with subtopics)
- Recruiter assignment to JDs (JDRecruiterAssignment table)
- Candidate CRUD with unique(email, jd_id) constraint
- 30-day cooling period for NOT_SELECTED candidates
- Single resume upload + AI extraction
- Bulk resume upload (max 20 files) → preview before save

### Phase 3 — Interviews, Scoring, QC, Operator (M3)
- Interview scheduling with timezone support
- Microsoft Teams meeting creation via Graph API (OAuth2 client credentials)
- Email notifications (SendGrid) to candidate, panelists, recruiter
- Panelist pre-assignment per JD (jd_panelist_assignments)
- Per-interview panelist assignment (panel_assignments)
- Panelist availability calendar
- Panelist scoring per JD skill (technical / communication / problem-solving, 1–10)
- Interview transcript upload (file or raw text)
- AI interview scoring via GPT-4o (Pydantic-validated response)
- QC validation workflow (approve/override/notes) → unlocks CLIENT portal
- CLIENT portal (approved results only, scoped to client)
- OPERATOR role for client-side interview coordination
- Panelist assignment bulk CSV upload

### Phase 4 — Reports & Analytics (M4 — Partial)
- Score report page with PDF export (jsPDF) and Excel export (XLSX)
- Full analytics dashboard, pipeline trend charts, utilization reports: **pending**

---

## 12. Pending Items & Next Steps

- [ ] M4 analytics dashboard (pipeline trends, recruiter utilization, panelist performance)
- [ ] Candidate status bulk update
- [ ] Interview rescheduling flow (update Teams event)
- [ ] Panelist availability conflict detection during scheduling
- [ ] Score normalization / weighted average calculation
- [ ] Email templates (currently plain text, needs HTML)
- [ ] Admin role-change UI (currently no PUT /users/{id}/role endpoint)
- [ ] Pagination on list endpoints (currently returns all records)
- [ ] Client-scoped OPERATOR creation (currently only ADMIN can create OPERATOR)
- [ ] Audit log / activity trail
- [ ] Frontend test suite

---

## 13. Key Business Rules

### 30-Day Cooling Period
- When a candidate's status is set to `NOT_SELECTED` for a JD, they cannot reapply to the same JD for 30 days.
- Checked in `POST /api/candidates` and `POST /api/candidates/bulk-upload-resumes`.
- Tracked via `status_updated_at` column on candidates.

### JD Extraction Idempotency
- Skill extraction is cached: `skills_extraction_hash` stores MD5 of JD `raw_text`.
- If `POST /{jd_id}/extract-skills` is called and hash hasn't changed, returns cached skills (no GPT-4o call).
- Rate limited to 20 requests/hour regardless.
- Manually added/edited skills are not overwritten by re-extraction.

### Teams Integration
- Creates a Teams meeting via Microsoft Graph API using OAuth2 client credentials flow.
- Token is cached in-process with `expires_at` tracking.
- Meeting attendees = candidate + all assigned panelists.
- `external_event_id` + `teams_meeting_id` stored on interview for cancellation.
- If Teams env vars are missing, interview is created without a meeting link (graceful degradation).

### Bulk Resume Upload Rules
- Max 20 files per request.
- File types: `.pdf`, `.docx` only.
- Max file size: 2 MB per file.
- Returns a preview (extracted fields) before any DB records are created.
- Duplicates detected by (email, jd_id) — blocked before save.
- Cooling period checked per candidate — blocked before save.
- All validation errors returned together (not fail-fast).

### Job Code Format
- Auto-assigned after JD creation: `JD-{YEAR}-{ID:04d}`
- Example: `JD-2026-0001`

### Role Hierarchy for User Creation
- You cannot create a user with a role equal to or higher than your own.
- M_RECRUITER → can create SR_RECRUITER, RECRUITER
- SR_RECRUITER → can create RECRUITER
- Cross-client assignment blocked: `reports_to` manager must be in same client.

### QC Approval Gate
- Candidate results only appear in CLIENT portal after QC approves (`approved=True` on feedback_validation).
- QC can override AI recommendation and individual skill scores.

### File Storage Paths
- Resumes: `uploads/resumes/{candidate_id}_{timestamp}_{filename}`
- JD files: `uploads/jd_files/{jd_id}_{timestamp}_{filename}`
- Transcripts: `uploads/transcripts/{interview_id}_{timestamp}_{filename}`

---

## 14. File Structure Overview

```
iaas/
├── CLAUDE.md                          ← This file
├── README.md                          ← Local setup guide
├── ROLES_AND_ACCESS.md                ← Role reference (human-readable)
├── docker-compose.yml
├── .github/workflows/deploy.yml
│
├── iaas-backend/
│   ├── wsgi.py                        ← Entry point
│   ├── seed.py                        ← Seeds admin user
│   ├── requirements.txt
│   ├── .env                           ← Local secrets (not committed)
│   ├── app/
│   │   ├── __init__.py                ← Flask app factory, blueprint registration
│   │   ├── config.py                  ← Config class (JWT, DB, CORS)
│   │   ├── blueprints/
│   │   │   ├── __init__.py            ← Blueprint imports
│   │   │   ├── auth.py
│   │   │   ├── users.py
│   │   │   ├── clients.py
│   │   │   ├── job_descriptions.py
│   │   │   ├── candidates.py
│   │   │   ├── interviews.py
│   │   │   ├── scoring.py
│   │   │   ├── qc.py
│   │   │   ├── panelist_assignments.py
│   │   │   └── client_portal.py
│   │   ├── models/
│   │   │   ├── __init__.py            ← SQLAlchemy db instance
│   │   │   ├── user.py
│   │   │   ├── client.py
│   │   │   ├── job_description.py     ← JD + JDSkill + JDRecruiterAssignment
│   │   │   ├── candidate.py
│   │   │   ├── interview_schedule.py  ← Interview + PanelAssignment + PanelistAvailability + Scores + Transcripts + AIScore
│   │   │   ├── jd_panelist_assignment.py
│   │   │   └── feedback_validation.py
│   │   ├── schemas/
│   │   │   ├── auth_schema.py
│   │   │   ├── user_schema.py
│   │   │   ├── client_schema.py
│   │   │   ├── jd_schema.py
│   │   │   └── candidate_schema.py
│   │   ├── services/
│   │   │   ├── file_parser.py         ← PDF + DOCX text extraction
│   │   │   ├── skill_extractor.py     ← GPT-4o JD skill extraction
│   │   │   ├── ai_scorer.py           ← GPT-4o interview scoring
│   │   │   ├── email_service.py       ← SendGrid notifications
│   │   │   └── teams_service.py       ← Microsoft Graph Teams integration
│   │   └── utils/
│   │       └── (helpers)
│   ├── migrations/
│   │   ├── alembic.ini
│   │   ├── env.py
│   │   └── versions/
│   │       └── (20 migration files — see Section 7)
│   └── uploads/
│       ├── resumes/
│       ├── jd_files/
│       └── transcripts/
│
└── iaas-frontend/
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.js
    └── src/
        ├── App.jsx                    ← Router + ProtectedRoute setup
        ├── main.jsx
        ├── api/
        │   ├── axiosInstance.js       ← Base URL, CSRF interceptor, auth interceptor
        │   ├── authApi.js
        │   ├── candidatesApi.js
        │   ├── clientsApi.js
        │   ├── clientPortalApi.js
        │   ├── interviewsApi.js
        │   ├── jdApi.js
        │   ├── panelistAssignmentsApi.js
        │   ├── qcApi.js
        │   ├── scoringApi.js
        │   └── usersApi.js
        ├── store/
        │   └── authStore.js           ← Zustand: user, setUser, logout, hasRoleAccess
        ├── pages/
        │   ├── Login.jsx
        │   ├── Dashboard.jsx
        │   ├── ClientDashboard.jsx
        │   ├── Candidates.jsx
        │   ├── JDManagement.jsx
        │   ├── SkillExtractionHub.jsx
        │   ├── SkillExtraction.jsx
        │   ├── Interviews.jsx
        │   ├── Scoring.jsx
        │   ├── QCReview.jsx
        │   ├── ScoreReport.jsx
        │   ├── Users.jsx
        │   ├── PanelistAssignments.jsx
        │   └── PanelistSlots.jsx
        └── components/
            ├── AppShell.jsx
            ├── Sidebar.jsx
            ├── PlatformHeader.jsx
            ├── ProtectedRoute.jsx
            └── ui/                    ← Badge, Card, DataTable, FormField, etc.
```

---

## 15. Security Architecture

| Layer | Mechanism |
|---|---|
| Auth tokens | JWT in HTTPOnly cookies (access 15min, refresh 7 days) |
| CSRF | X-CSRF-TOKEN header required on all mutating requests |
| Password storage | pbkdf2_sha256 via passlib |
| Rate limiting | Login: 5/min; skill extraction: 20/hr |
| Token revocation | RevokedToken table checked on every request |
| File path safety | Downloads validated against `uploads/` directory to prevent traversal |
| File validation | Extension whitelist (.pdf/.docx/.txt) + size limits (2MB resumes, 10MB JD, 5MB transcripts) |
| Email normalization | Emails lowercased + trimmed before comparison/storage |

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
- Roles: ADMIN, M_RECRUITER, SR_RECRUITER, RECRUITER, 
  PANELIST, QC, CLIENT, OPERATOR
- User hierarchy with reports_to foreign key
- Docker Compose: frontend, backend, MySQL, Nginx Proxy Manager
- GitHub Actions CI/CD deploying to DigitalOcean droplet
- Images at ghcr.io/gowtham-0903/

### Module 2 — JD and AI Extraction (Complete)
- Client management with metrics
- JD upload PDF/DOCX via PyMuPDF and python-docx
- GPT-4o skill extraction with Pydantic validation and 3x retry
- JD extraction now idempotent via SHA256 hash of raw_text
- skills_extraction_hash + skills_extracted_at on job_descriptions
- JD-Recruiter assignment system via jd_recruiter_assignments
- Skill types: primary, secondary, soft
- Skill review UI with edit/delete/add manual

### Module 3 — Candidates and Interviews (Complete)
- Single candidate creation with resume upload (PDF/DOCX, 2MB)
- AI extraction of name, email, phone from resume via GPT-4o
- Bulk resume upload: up to 20 files, OPERATOR role only
- candidate_extracted_skills JSON column stores resume skills
- 30-day cooling period for NOT_SELECTED candidates
  (checked via status_updated_at column)
- Role-based JD filtering: RECRUITER sees only assigned JDs
- JD-first scheduling flow with candidate table showing
  Scheduled/Not Scheduled status per candidate
- Candidate email is primary identifier in scheduling
- Teams integration via Microsoft Graph calendar events
  POST /users/{organizerId}/events with isOnlineMeeting: true
- One unique Teams meeting per interview (not shared)
- Timezone-aware: stores UTC, scheduler picks IANA timezone
- Panelist assignment module: manual + Excel import
  Excel columns: panelist_email, jd_code, client_name
- Panelist selector shows full_name — email
- SendGrid emails to candidate, all panelists, recruiter
  with Teams join link and local time in selected timezone
- Interview cancellation cancels Teams event via Graph API
- Max 3 panelists per interview

### Module 4 — Feedback Scoring and Reports (PENDING)
Next to build:
- CandidateSkillRating model (1-10 scale, 3 dimensions)
- Structured feedback API (submit per panelist per skill)
- AI scoring engine: weighted average + GPT-4o narrative
- Recommendation thresholds: Strong Hire 85%, Hire 70%,
  Maybe 50%, No Hire below
- React feedback form with skill cards from JD skills
- QC review and validation workflow
- Client report page with Recharts bar chart
- PDF download via jsPDF
- Email report via WeasyPrint + SendGrid

### Teams Integration Details
- Organizer account: Interview@meedenlabs.com
- Env vars: TEAMS_CLIENT_ID, TEAMS_CLIENT_SECRET,
  TEAMS_TENANT_ID, TEAMS_ORGANIZER_USER_ID, 
  TEAMS_ORGANIZER_EMAIL
- Azure permissions: Calendars.ReadWrite, 
  OnlineMeetings.ReadWrite.All (application permissions)
- Application access policy required via PowerShell:
  New-CsApplicationAccessPolicy + Grant-CsApplicationAccessPolicy
- Token cached at module level with expiry buffer
- Scheduling fails if Teams creation fails (atomic)
- Calendar event cancelled on interview CANCELLED status

### Key Business Rules
- Cooling period: 30 days after NOT_SELECTED for same email+JD
- JD extraction: idempotent, skips AI if hash unchanged
- Interview mode: virtual only (Teams), no in-person for now
- Max panelists: 3 per interview
- Panelist assignment: must exist in jd_panelist_assignments
  for panelist to appear in scheduling selector
- Candidate status flow: APPLIED → SHORTLISTED → INTERVIEWED
  → SELECTED or NOT_SELECTED
- Resume size: 2MB per file
- Skills per JD: extracted once, re-extract requires confirmation

### Deployment Commands
- Backend: FLASK_APP=wsgi.py ./venv/bin/flask db upgrade
- Frontend: npm run build
- Docker: docker-compose up -d --remove-orphans
- Migrations current head: l3m4n5o6p7q8

### Pending Before Demo
- Complete Microsoft Azure app registration
- Run PowerShell Application Access Policy for 
  Interview@meedenlabs.com
- Add 5 Teams env vars to .env
- Verify Postman test returns joinUrl
- End-to-end test: schedule → Teams link → emails received

---

*Last updated: 2026-05-02 | Branch: feature/module-3-complete*
