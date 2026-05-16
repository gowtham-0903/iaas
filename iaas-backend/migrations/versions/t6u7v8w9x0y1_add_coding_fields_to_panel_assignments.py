"""Add coding fields to panel_assignments

Revision ID: t6u7v8w9x0y1
Revises: s5t6u7v8w9x0
Create Date: 2026-05-12

"""
from alembic import op
import sqlalchemy as sa

revision = "t6u7v8w9x0y1"
down_revision = "s5t6u7v8w9x0"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("panel_assignments") as batch_op:
        batch_op.add_column(sa.Column("coding_qa",       sa.JSON(),         nullable=True))
        batch_op.add_column(sa.Column("coding_score",    sa.SmallInteger(), nullable=True))
        batch_op.add_column(sa.Column("coding_comments", sa.Text(),         nullable=True))
        batch_op.add_column(sa.Column("no_coding_round", sa.Boolean(),      nullable=True, server_default=sa.false()))


def downgrade():
    with op.batch_alter_table("panel_assignments") as batch_op:
        batch_op.drop_column("no_coding_round")
        batch_op.drop_column("coding_comments")
        batch_op.drop_column("coding_score")
        batch_op.drop_column("coding_qa")
