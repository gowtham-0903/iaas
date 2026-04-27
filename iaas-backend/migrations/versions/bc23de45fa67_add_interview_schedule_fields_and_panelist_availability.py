from __future__ import annotations
"""add interview schedule fields and panelist availability

Revision ID: bc23de45fa67
Revises: ab12cd34ef56
Create Date: 2026-04-27 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'bc23de45fa67'
down_revision = 'ab12cd34ef56'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE IF NOT EXISTS interview_schedules (
            id INT NOT NULL AUTO_INCREMENT,
            candidate_id INT NOT NULL,
            jd_id INT NOT NULL,
            scheduled_at DATETIME NOT NULL,
            mode VARCHAR(20) NOT NULL DEFAULT 'virtual',
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            FOREIGN KEY (candidate_id) REFERENCES candidates(id),
            FOREIGN KEY (jd_id) REFERENCES job_descriptions(id)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS panel_assignments (
            id INT NOT NULL AUTO_INCREMENT,
            interview_id INT NOT NULL,
            panelist_id INT NOT NULL,
            assigned_by INT NOT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uq_interview_panelist (interview_id, panelist_id),
            FOREIGN KEY (interview_id) REFERENCES interview_schedules(id),
            FOREIGN KEY (panelist_id) REFERENCES users(id),
            FOREIGN KEY (assigned_by) REFERENCES users(id)
        )
    """)

    op.execute("""
        ALTER TABLE interview_schedules
        ADD COLUMN status ENUM('SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED')
        NOT NULL DEFAULT 'SCHEDULED'
    """)
    op.execute("""
        ALTER TABLE interview_schedules
        ADD COLUMN meeting_link VARCHAR(500) NULL
    """)
    op.execute("""
        ALTER TABLE interview_schedules
        ADD COLUMN notes TEXT NULL
    """)
    op.execute("""
        ALTER TABLE interview_schedules
        ADD COLUMN duration_minutes INT NULL DEFAULT 60
    """)

    op.create_table(
        'panelist_availability',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('panelist_id', sa.Integer(), nullable=False),
        sa.Column('available_date', sa.Date(), nullable=False),
        sa.Column('start_time', sa.Time(), nullable=False),
        sa.Column('end_time', sa.Time(), nullable=False),
        sa.Column('is_booked', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['panelist_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('panelist_id', 'available_date', 'start_time',
                            name='uq_panelist_availability')
    )


def downgrade():
    op.drop_table('panelist_availability')
    op.execute("ALTER TABLE interview_schedules DROP COLUMN duration_minutes")
    op.execute("ALTER TABLE interview_schedules DROP COLUMN notes")
    op.execute("ALTER TABLE interview_schedules DROP COLUMN meeting_link")
    op.execute("ALTER TABLE interview_schedules DROP COLUMN status")
    op.drop_table('panel_assignments')
    op.drop_table('interview_schedules')
