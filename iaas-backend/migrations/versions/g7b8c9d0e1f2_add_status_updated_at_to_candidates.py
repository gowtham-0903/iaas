"""add status_updated_at to candidates

Revision ID: g7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-04-28 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'g7b8c9d0e1f2'
down_revision = 'f6a7b8c9d0e1'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'candidates',
        sa.Column('status_updated_at', sa.DateTime(), nullable=True)
    )


def downgrade():
    op.drop_column('candidates', 'status_updated_at')
