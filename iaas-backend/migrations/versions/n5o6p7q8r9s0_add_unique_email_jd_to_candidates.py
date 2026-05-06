"""add unique(email, jd_id) constraint to candidates

Revision ID: n5o6p7q8r9s0
Revises: m4n5o6p7q8r9
Create Date: 2026-05-05

"""
from alembic import op

revision = 'n5o6p7q8r9s0'
down_revision = 'm4n5o6p7q8r9'
branch_labels = None
depends_on = None


def upgrade():
    # Remove any existing duplicates before adding the constraint
    op.execute("""
        DELETE c1 FROM candidates c1
        INNER JOIN candidates c2
            ON LOWER(c1.email) = LOWER(c2.email)
            AND c1.jd_id = c2.jd_id
            AND c1.id > c2.id
    """)
    op.create_unique_constraint('uq_candidates_email_jd', 'candidates', ['email', 'jd_id'])


def downgrade():
    op.drop_constraint('uq_candidates_email_jd', 'candidates', type_='unique')
