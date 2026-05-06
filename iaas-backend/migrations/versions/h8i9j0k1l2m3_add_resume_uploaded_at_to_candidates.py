"""add resume_uploaded_at to candidates

Revision ID: h8i9j0k1l2m3
Revises: g7b8c9d0e1f2
Create Date: 2026-05-01 11:15:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "h8i9j0k1l2m3"
down_revision = "g7b8c9d0e1f2"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "candidates",
        sa.Column("resume_uploaded_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        """
        UPDATE candidates
        SET resume_uploaded_at = created_at
        WHERE resume_url IS NOT NULL
        """
    )


def downgrade():
    op.drop_column("candidates", "resume_uploaded_at")
