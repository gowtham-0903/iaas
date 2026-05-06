"""add candidate_extracted_skills column

Revision ID: h8c9d0e1f2g3
Revises: g7b8c9d0e1f2
Create Date: 2026-04-28 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'h8c9d0e1f2g3'
down_revision = 'g7b8c9d0e1f2'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'candidates',
        sa.Column('candidate_extracted_skills', sa.JSON(), nullable=True)
    )


def downgrade():
    op.drop_column('candidates', 'candidate_extracted_skills')
