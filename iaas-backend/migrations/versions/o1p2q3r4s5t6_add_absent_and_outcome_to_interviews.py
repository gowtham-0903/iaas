"""add absent status and outcome column to interview_schedules

Revision ID: o1p2q3r4s5t6
Revises: n5o6p7q8r9s0
Branch Labels: None
Depends On: None

"""
from alembic import op
import sqlalchemy as sa


revision = 'o1p2q3r4s5t6'
down_revision = 'n5o6p7q8r9s0'
branch_labels = None
depends_on = None


def upgrade():
    # Add ABSENT to interview status enum
    op.execute(
        "ALTER TABLE interview_schedules MODIFY status "
        "ENUM('SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED','ABSENT') NOT NULL DEFAULT 'SCHEDULED'"
    )
    # Add outcome column — only populated when status = COMPLETED
    op.execute(
        "ALTER TABLE interview_schedules ADD COLUMN outcome "
        "ENUM('SELECTED','NOT_SELECTED') NULL DEFAULT NULL"
    )


def downgrade():
    op.execute("ALTER TABLE interview_schedules DROP COLUMN outcome")
    op.execute(
        "ALTER TABLE interview_schedules MODIFY status "
        "ENUM('SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED') NOT NULL DEFAULT 'SCHEDULED'"
    )
