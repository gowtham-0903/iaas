"""add candidates table

Revision ID: c3f9f0a9f2b1
Revises: 8e914d99322b
Create Date: 2026-04-16 23:20:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c3f9f0a9f2b1'
down_revision = '8e914d99322b'
branch_labels = None
depends_on = None


candidate_status_enum = sa.Enum(
    'APPLIED',
    'SHORTLISTED',
    'INTERVIEWED',
    'SELECTED',
    'NOT_SELECTED',
    name='candidate_status_enum',
)


def upgrade():
    candidate_status_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        'candidates',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('client_id', sa.Integer(), nullable=False),
        sa.Column('jd_id', sa.Integer(), nullable=False),
        sa.Column('full_name', sa.String(length=255), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('status', candidate_status_enum, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['client_id'], ['clients.id']),
        sa.ForeignKeyConstraint(['jd_id'], ['job_descriptions.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_candidates_client_id', 'candidates', ['client_id'])
    op.create_index('ix_candidates_jd_id', 'candidates', ['jd_id'])
    op.create_index('ix_candidates_status', 'candidates', ['status'])


def downgrade():
    op.drop_index('ix_candidates_status', table_name='candidates')
    op.drop_index('ix_candidates_jd_id', table_name='candidates')
    op.drop_index('ix_candidates_client_id', table_name='candidates')
    op.drop_table('candidates')

    candidate_status_enum.drop(op.get_bind(), checkfirst=True)
