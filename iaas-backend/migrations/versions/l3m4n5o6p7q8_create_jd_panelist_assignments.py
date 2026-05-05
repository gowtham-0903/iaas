"""create jd panelist assignments

Revision ID: l3m4n5o6p7q8
Revises: k2l3m4n5o6p7
Create Date: 2026-05-02 10:10:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "l3m4n5o6p7q8"
down_revision = "k2l3m4n5o6p7"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "jd_panelist_assignments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("jd_id", sa.Integer(), nullable=False),
        sa.Column("panelist_id", sa.Integer(), nullable=False),
        sa.Column("client_id", sa.Integer(), nullable=False),
        sa.Column("assigned_by", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["assigned_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"]),
        sa.ForeignKeyConstraint(["jd_id"], ["job_descriptions.id"]),
        sa.ForeignKeyConstraint(["panelist_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("jd_id", "panelist_id", name="uq_jd_panelist"),
    )


def downgrade():
    op.drop_table("jd_panelist_assignments")
