"""Allow NULL transcript_id in ai_interview_scores for transcriptless scoring.

Revision ID: x4y5z6a7b8c9
Revises: w3x4y5z6a7b8
Create Date: 2026-05-14

"""
import sqlalchemy as sa
from alembic import op

revision = 'x4y5z6a7b8c9'
down_revision = 'w3x4y5z6a7b8'
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column(
        'ai_interview_scores',
        'transcript_id',
        existing_type=sa.Integer(),
        nullable=True,
    )


def downgrade():
    op.alter_column(
        'ai_interview_scores',
        'transcript_id',
        existing_type=sa.Integer(),
        nullable=False,
    )
