"""create operator client assignments

Revision ID: m4n5o6p7q8r9
Revises: l3m4n5o6p7q8
Create Date: 2026-05-05 10:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "m4n5o6p7q8r9"
down_revision = "l3m4n5o6p7q8"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "operator_client_assignments",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("operator_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("client_id", sa.Integer, sa.ForeignKey("clients.id", ondelete="CASCADE"), nullable=False),
        sa.UniqueConstraint("operator_id", "client_id", name="uq_operator_client"),
    )
    op.create_index("ix_operator_client_operator_id", "operator_client_assignments", ["operator_id"])
    op.create_index("ix_operator_client_client_id", "operator_client_assignments", ["client_id"])


def downgrade():
    op.drop_index("ix_operator_client_client_id", table_name="operator_client_assignments")
    op.drop_index("ix_operator_client_operator_id", table_name="operator_client_assignments")
    op.drop_table("operator_client_assignments")
