# IAAS Backend Flask Skill

## When This Skill Activates
- Creating or editing any file in iaas-backend/
- Creating new blueprints, models, migrations, services
- Writing backend tests
- Debugging Flask errors

## Project-Specific Rules

### Blueprint Structure
- Every blueprint goes in iaas-backend/app/blueprints/
- Register blueprint in iaas-backend/app/__init__.py
- Import in iaas-backend/app/blueprints/__init__.py
- URL prefix format: /api/{resource-name}
- Use @jwt_required() on all protected routes
- Use @role_required([...]) for role gating
- Use @limiter.limit("N per hour") on AI and creation endpoints

### Model Structure
- Every model goes in iaas-backend/app/models/
- Import db from app.extensions not app.models
- Use db.session.get(Model, id) not Model.query.get(id)
- Always define __tablename__ explicitly
- Foreign keys use db.ForeignKey with ondelete where needed
- ENUM values stored as strings matching UserRole.VALUE.value

### Migration Rules
- Never write raw SQL migrations
- Always use flask db migrate then review auto-generated file
- Always write downgrade() function
- Test on fresh DB before committing
- Update CLAUDE.md Section 7 after migration created
- Current head as of last update: p2q3r4s5t6u7

### Error Handling Rules
- Never return raw str(err) to API caller
- Always log with current_app.logger.exception()
- Return generic "Internal server error" with 500
- Specific validation errors return 400 with field details
- Not found returns 404 with resource name
- Forbidden returns 403 with reason

### External Service Rules
- OpenAI: always use 3x retry with exponential backoff
- OpenAI: always validate response with Pydantic
- SendGrid: wrap in try/except, log failure, do not crash request
- Teams: if env vars missing, degrade gracefully (no meeting link)
- Teams: token cached at module level with expires_at check

### Testing Rules
- Use SQLite in-memory via TestingConfig
- Mock all external services (OpenAI, SendGrid, Teams)
- Use auth_headers(app, user) helper from conftest.py
- Every new blueprint needs a matching test_{blueprint}.py
- Rate limiting disabled in tests via RATELIMIT_ENABLED=False
