"""feedback production fixes

- panel_assignments: add overall_comments (TEXT NULL) and recommendation (VARCHAR(20) NULL)
- interview_scores: add overall_score (INT NULL), make technical/communication/problem_solving nullable

Revision ID: r4s5t6u7v8w9
Revises: q3r4s5t6u7v8
Create Date: 2026-05-09
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "r4s5t6u7v8w9"
down_revision = "q3r4s5t6u7v8"
branch_labels = None
depends_on = None


def upgrade():
    # Fix 1: panel_assignments — persist overall_comments and recommendation
    op.add_column("panel_assignments", sa.Column("overall_comments", sa.Text(), nullable=True))
    op.add_column("panel_assignments", sa.Column("recommendation", sa.String(20), nullable=True))

    # Fix 2: interview_scores — add overall_score; make sub-scores nullable so
    # magic-link submissions don't need to duplicate one value across all three columns
    op.add_column("interview_scores", sa.Column("overall_score", sa.Integer(), nullable=True))
    op.alter_column("interview_scores", "technical_score", existing_type=sa.Integer(), nullable=True)
    op.alter_column("interview_scores", "communication_score", existing_type=sa.Integer(), nullable=True)
    op.alter_column("interview_scores", "problem_solving_score", existing_type=sa.Integer(), nullable=True)


def downgrade():
    op.alter_column("interview_scores", "problem_solving_score", existing_type=sa.Integer(), nullable=False)
    op.alter_column("interview_scores", "communication_score", existing_type=sa.Integer(), nullable=False)
    op.alter_column("interview_scores", "technical_score", existing_type=sa.Integer(), nullable=False)
    op.drop_column("interview_scores", "overall_score")

    op.drop_column("panel_assignments", "recommendation")
    op.drop_column("panel_assignments", "overall_comments")
