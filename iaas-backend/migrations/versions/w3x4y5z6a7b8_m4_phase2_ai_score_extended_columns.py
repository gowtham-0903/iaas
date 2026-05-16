"""M4 Phase 2: extend ai_interview_scores with report fields

Revision ID: w3x4y5z6a7b8
Revises: v2w3x4y5z6a7
Create Date: 2026-05-14

Changes:
- ai_interview_scores: add primary_match (DECIMAL 5,2 NULL),
  secondary_match (DECIMAL 5,2 NULL), skill_breakdown (JSON NULL),
  ai_suggestion (LONGTEXT NULL)
"""
from alembic import op
import sqlalchemy as sa


revision = "w3x4y5z6a7b8"
down_revision = "v2w3x4y5z6a7"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("ai_interview_scores") as batch_op:
        batch_op.add_column(
            sa.Column("primary_match", sa.Numeric(5, 2), nullable=True)
        )
        batch_op.add_column(
            sa.Column("secondary_match", sa.Numeric(5, 2), nullable=True)
        )
        batch_op.add_column(
            sa.Column("skill_breakdown", sa.JSON(), nullable=True)
        )
        batch_op.add_column(
            sa.Column(
                "ai_suggestion",
                sa.Text().with_variant(sa.dialects.mysql.LONGTEXT(), "mysql"),
                nullable=True,
            )
        )


def downgrade():
    with op.batch_alter_table("ai_interview_scores") as batch_op:
        batch_op.drop_column("ai_suggestion")
        batch_op.drop_column("skill_breakdown")
        batch_op.drop_column("secondary_match")
        batch_op.drop_column("primary_match")
