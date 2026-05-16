# IAAS Database Migration Skill

## When This Skill Activates
- Adding new columns or tables
- Modifying existing columns
- Creating new models
- Running flask db migrate

## Current State
- Database: MySQL 8.0 in Docker
- ORM: SQLAlchemy via Flask-SQLAlchemy
- Migration tool: Alembic via Flask-Migrate
- Current head: p2q3r4s5t6u7
- Total migrations: 24 (see CLAUDE.md Section 7)

## Rules

### Before Creating Migration
- Confirm model change is complete and saved
- Run: flask db migrate -m "description of change"
- Review auto-generated file in migrations/versions/
- Verify upgrade() does what is expected
- Write downgrade() that reverses exactly

### Safe Migration Patterns
SAFE:
- Add nullable column with default
- Add new table
- Add index
- Rename via add+copy+drop in separate migrations

RISKY — requires care:
- Add NOT NULL column to existing table
  → must provide server_default or backfill first
- Add ENUM value to existing ENUM column
  → MySQL requires ALTER TABLE, test on copy first

NEVER:
- DROP TABLE in upgrade() without data backup confirmed
- DROP COLUMN without verifying nothing references it
- Change column type without testing data conversion

### After Migration Created
- Run on fresh DB to confirm no errors
- Run downgrade then upgrade again to confirm reversibility
- Update CLAUDE.md Section 7 with new migration ID and description
- Update "Migrations current head" in Project History

### Production Migration Safety
- Migrations run automatically on deploy via:
  docker exec iaas-backend flask db upgrade
- If migration fails, deploy fails (set -e in deploy script)
- Never run manual SQL on production DB
- Always test migration on staging first
