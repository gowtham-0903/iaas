# IAAS Security Skill

## When This Skill Activates
- Adding new endpoints
- Adding new user roles or permissions
- Adding file upload functionality
- Adding public endpoints (no auth)
- Reviewing code before push to main

## Security Checklist for New Code

### Every New Endpoint Must Have
- @jwt_required() OR explicit public justification in comment
- @role_required([roles]) for role-restricted routes
- Client ownership check: _can_access_client(role, user, resource.client_id)
- Input validation via Marshmallow schema
- Generic error response (no raw exceptions)
- Rate limiting on creation and AI endpoints

### Public Endpoints (No Auth) — Current List
- POST /api/auth/login
- POST /api/auth/refresh
- GET /api/feedback/:token (magic link)
- POST /api/feedback/:token (magic link)
These are the ONLY public endpoints.
Any new public endpoint requires security review.

### File Upload Security
- Extension whitelist: .pdf, .docx, .txt only
- Size limits: resumes 2MB, JD files 10MB, transcripts 5MB
- Use werkzeug secure_filename() on all uploads
- Store files in uploads/ directory only
- Validate path on download to prevent traversal

### IDOR Prevention
- Always check resource belongs to user's client
- Never trust client_id from request body alone
- Use _can_access_client() helper on every mutating endpoint
- Cross-client access must return 403 not 404

### Secrets Management
- All secrets in .env file only
- .env never committed (in .gitignore)
- .env.example contains all keys with placeholder values
- JWT_SECRET_KEY: must be 32+ char random hex
- If JWT_SECRET_KEY missing or default → app refuses to start
- OPENAI_API_KEY: $50/month hard cap set in OpenAI dashboard

### Known Security Decisions (Documented)
- JWT role not re-validated against DB on every request
  (15min token window is accepted tradeoff)
- SameSite=Strict on JWT cookies
- JWT_COOKIE_SECURE=True in production
- RevokedToken cleanup: tokens older than 7 days deleted on login
- PANELIST/OPERATOR users see only PANELISTs in their client
