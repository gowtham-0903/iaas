"""add resume fields to candidates

Revision ID: ab12cd34ef56
Revises: f1a2b3c4d5e6
Create Date: 2026-04-27 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'ab12cd34ef56'
down_revision = 'f1a2b3c4d5e6'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('candidates', schema=None) as batch_op:
        batch_op.add_column(sa.Column('resume_url', sa.String(length=500), nullable=True))
        batch_op.add_column(sa.Column('resume_filename', sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column('phone', sa.String(length=50), nullable=True))
        batch_op.add_column(sa.Column('ai_extracted', sa.Boolean(), nullable=False, server_default=sa.text('0')))


def downgrade():
    with op.batch_alter_table('candidates', schema=None) as batch_op:
        batch_op.drop_column('ai_extracted')
        batch_op.drop_column('phone')
        batch_op.drop_column('resume_filename')
        batch_op.drop_column('resume_url')
