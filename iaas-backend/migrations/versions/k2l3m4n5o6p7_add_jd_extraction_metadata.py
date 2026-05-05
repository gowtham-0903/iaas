"""add jd extraction metadata

Revision ID: k2l3m4n5o6p7
Revises: j1k2l3m4n5o6
Create Date: 2026-05-02 10:05:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "k2l3m4n5o6p7"
down_revision = "j1k2l3m4n5o6"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "job_descriptions",
        sa.Column("skills_extraction_hash", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "job_descriptions",
        sa.Column("skills_extracted_at", sa.DateTime(), nullable=True),
    )


def downgrade():
    op.drop_column("job_descriptions", "skills_extracted_at")
    op.drop_column("job_descriptions", "skills_extraction_hash")
