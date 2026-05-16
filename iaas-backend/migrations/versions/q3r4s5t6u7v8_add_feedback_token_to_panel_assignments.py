"""add feedback token columns to panel_assignments

Revision ID: q3r4s5t6u7v8
Revises: p2q3r4s5t6u7
Branch Labels: None
Depends On: None

"""
from alembic import op
import sqlalchemy as sa


revision = 'q3r4s5t6u7v8'
down_revision = 'p2q3r4s5t6u7'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'panel_assignments',
        sa.Column('feedback_token', sa.String(255), nullable=True, unique=True)
    )
    op.add_column(
        'panel_assignments',
        sa.Column('token_expires_at', sa.DateTime(), nullable=True)
    )
    op.add_column(
        'panel_assignments',
        sa.Column('token_used', sa.Boolean(), nullable=False, server_default=sa.false())
    )
    op.add_column(
        'panel_assignments',
        sa.Column('token_used_at', sa.DateTime(), nullable=True)
    )
    op.create_index(
        'ix_panel_assignments_feedback_token',
        'panel_assignments',
        ['feedback_token'],
        unique=True,
    )


def downgrade():
    op.drop_index('ix_panel_assignments_feedback_token', table_name='panel_assignments')
    op.drop_column('panel_assignments', 'token_used_at')
    op.drop_column('panel_assignments', 'token_used')
    op.drop_column('panel_assignments', 'token_expires_at')
    op.drop_column('panel_assignments', 'feedback_token')
