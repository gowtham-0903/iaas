"""add interview scoring and transcript tables

Revision ID: cd34ef56ab78
Revises: bc23de45fa67
Create Date: 2026-04-27 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'cd34ef56ab78'
down_revision = 'bc23de45fa67'
branch_labels = None
depends_on = None


upload_type_enum = sa.Enum('file', 'text', name='upload_type_enum')
recommendation_enum = sa.Enum('STRONG_HIRE', 'HIRE', 'MAYBE', 'NO_HIRE', name='ai_recommendation_enum')
report_status_enum = sa.Enum('PENDING', 'GENERATED', 'FAILED', name='ai_report_status_enum')


def upgrade():
    op.create_table(
        'interview_scores',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('interview_id', sa.Integer(), nullable=False),
        sa.Column('panelist_id', sa.Integer(), nullable=False),
        sa.Column('skill_id', sa.Integer(), nullable=False),
        sa.Column('technical_score', sa.Integer(), nullable=False),
        sa.Column('communication_score', sa.Integer(), nullable=False),
        sa.Column('problem_solving_score', sa.Integer(), nullable=False),
        sa.Column('comments', sa.Text(), nullable=True),
        sa.Column('submitted_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['interview_id'], ['interview_schedules.id']),
        sa.ForeignKeyConstraint(['panelist_id'], ['users.id']),
        sa.ForeignKeyConstraint(['skill_id'], ['jd_skills.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('interview_id', 'panelist_id', 'skill_id', name='uq_interview_scores_interview_panelist_skill'),
    )

    op.create_table(
        'interview_transcripts',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('interview_id', sa.Integer(), nullable=False),
        sa.Column('uploaded_by', sa.Integer(), nullable=False),
        sa.Column('file_url', sa.String(length=500), nullable=True),
        sa.Column('raw_text', sa.Text(), nullable=True),
        sa.Column('upload_type', upload_type_enum, nullable=False),
        sa.Column('uploaded_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['interview_id'], ['interview_schedules.id']),
        sa.ForeignKeyConstraint(['uploaded_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('interview_id', name='uq_interview_transcripts_interview_id'),
    )

    op.create_table(
        'ai_interview_scores',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('interview_id', sa.Integer(), nullable=False),
        sa.Column('transcript_id', sa.Integer(), nullable=False),
        sa.Column('overall_score', sa.DECIMAL(precision=5, scale=2), nullable=True),
        sa.Column('skill_scores', sa.JSON(), nullable=True),
        sa.Column('strengths', sa.JSON(), nullable=True),
        sa.Column('concerns', sa.JSON(), nullable=True),
        sa.Column('recommendation', recommendation_enum, nullable=True),
        sa.Column('ai_raw_response', sa.Text(), nullable=True),
        sa.Column('generated_at', sa.DateTime(), nullable=False),
        sa.Column('report_status', report_status_enum, nullable=False, server_default=sa.text("'PENDING'")),
        sa.ForeignKeyConstraint(['interview_id'], ['interview_schedules.id']),
        sa.ForeignKeyConstraint(['transcript_id'], ['interview_transcripts.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('interview_id', name='uq_ai_interview_scores_interview_id'),
    )


def downgrade():
    op.drop_table('ai_interview_scores')
    op.drop_table('interview_transcripts')
    op.drop_table('interview_scores')

    report_status_enum.drop(op.get_bind(), checkfirst=True)
    recommendation_enum.drop(op.get_bind(), checkfirst=True)
    upload_type_enum.drop(op.get_bind(), checkfirst=True)
