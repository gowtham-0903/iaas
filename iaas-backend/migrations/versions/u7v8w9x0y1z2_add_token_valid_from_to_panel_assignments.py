"""Add token_valid_from to panel_assignments

Revision ID: u7v8w9x0y1z2
Revises: t6u7v8w9x0y1
Create Date: 2026-05-12

"""
from alembic import op
import sqlalchemy as sa

revision = "u7v8w9x0y1z2"
down_revision = "t6u7v8w9x0y1"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("panel_assignments") as batch_op:
        batch_op.add_column(sa.Column("token_valid_from", sa.DateTime(), nullable=True))


def downgrade():
    with op.batch_alter_table("panel_assignments") as batch_op:
        batch_op.drop_column("token_valid_from")
