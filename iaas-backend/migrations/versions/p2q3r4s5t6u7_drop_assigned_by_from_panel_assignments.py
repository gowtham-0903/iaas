"""drop assigned_by from panel_assignments

assigned_by was created NOT NULL with no default, but the interview
scheduling code never populates it — causing every interview creation
to fail with a MySQL strict-mode constraint violation.

Revision ID: p2q3r4s5t6u7
Revises: o1p2q3r4s5t6
Branch Labels: None
Depends On: None

"""
from alembic import op
import sqlalchemy as sa


revision = 'p2q3r4s5t6u7'
down_revision = 'o1p2q3r4s5t6'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()

    # Find and drop the FK that references users(id) via assigned_by
    fk_rows = conn.execute(sa.text("""
        SELECT kcu.CONSTRAINT_NAME
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
        JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
          ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
         AND tc.TABLE_NAME = kcu.TABLE_NAME
         AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
        WHERE kcu.TABLE_NAME = 'panel_assignments'
          AND kcu.COLUMN_NAME = 'assigned_by'
          AND tc.CONSTRAINT_TYPE = 'FOREIGN KEY'
          AND kcu.TABLE_SCHEMA = DATABASE()
    """)).fetchall()

    for row in fk_rows:
        conn.execute(sa.text(
            f"ALTER TABLE panel_assignments DROP FOREIGN KEY `{row[0]}`"
        ))

    # Drop the column only if it exists
    col_exists = conn.execute(sa.text("""
        SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'panel_assignments'
          AND COLUMN_NAME = 'assigned_by'
          AND TABLE_SCHEMA = DATABASE()
    """)).scalar()

    if col_exists:
        conn.execute(sa.text(
            "ALTER TABLE panel_assignments DROP COLUMN assigned_by"
        ))


def downgrade():
    op.execute(
        "ALTER TABLE panel_assignments ADD COLUMN assigned_by INT NULL"
    )
