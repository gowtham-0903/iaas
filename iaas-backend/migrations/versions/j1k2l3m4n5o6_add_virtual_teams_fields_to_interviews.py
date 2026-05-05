"""add virtual teams fields to interviews

Revision ID: j1k2l3m4n5o6
Revises: i9j0k1l2m3n4
Create Date: 2026-05-02 10:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "j1k2l3m4n5o6"
down_revision = "i9j0k1l2m3n4"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "interview_schedules",
        sa.Column("timezone", sa.String(length=100), nullable=False, server_default="America/New_York"),
    )
    op.add_column(
        "interview_schedules",
        sa.Column("external_event_id", sa.String(length=500), nullable=True),
    )
    op.add_column(
        "interview_schedules",
        sa.Column("teams_meeting_id", sa.String(length=500), nullable=True),
    )
    op.alter_column("interview_schedules", "timezone", server_default=None)


def downgrade():
    op.drop_column("interview_schedules", "teams_meeting_id")
    op.drop_column("interview_schedules", "external_event_id")
    op.drop_column("interview_schedules", "timezone")
