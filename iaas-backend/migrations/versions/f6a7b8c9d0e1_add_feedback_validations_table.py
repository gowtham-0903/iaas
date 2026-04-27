"""add feedback validations table

Revision ID: f6a7b8c9d0e1
Revises: cd34ef56ab78
Create Date: 2026-04-27 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'f6a7b8c9d0e1'
down_revision = 'cd34ef56ab78'
branch_labels = None
depends_on = None


recommendation_enum = sa.Enum('STRONG_HIRE', 'HIRE', 'MAYBE', 'NO_HIRE', name='qc_recommendation_enum')
validation_status_enum = sa.Enum('PENDING', 'VALIDATED', name='feedback_validation_status_enum')


def upgrade():
    op.create_table(
        'feedback_validations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('interview_id', sa.Integer(), nullable=False),
        sa.Column('validated_by', sa.Integer(), nullable=False),
        sa.Column('status', validation_status_enum, nullable=False, server_default=sa.text("'PENDING'")),
        sa.Column('final_recommendation', recommendation_enum, nullable=False),
        sa.Column('qc_notes', sa.Text(), nullable=True),
        sa.Column('skill_overrides', sa.JSON(), nullable=True),
        sa.Column('approved', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.Column('validated_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['interview_id'], ['interview_schedules.id']),
        sa.ForeignKeyConstraint(['validated_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('interview_id', name='uq_feedback_validations_interview_id'),
    )


def downgrade():
    op.drop_table('feedback_validations')
    validation_status_enum.drop(op.get_bind(), checkfirst=True)
    recommendation_enum.drop(op.get_bind(), checkfirst=True)
