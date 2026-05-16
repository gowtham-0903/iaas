"""M4 Phase 1: distribution columns + transcript fetch columns

Revision ID: v2w3x4y5z6a7
Revises: u7v8w9x0y1z2
Create Date: 2026-05-14

Changes:
- ai_interview_scores: add report_distributed (BOOL), distributed_at (DATETIME NULL),
  distribution_log (JSON NULL)
- feedback_validations: add distribution_triggered (BOOL), distributed_at (DATETIME NULL),
  distributed_to (JSON NULL)
- interview_transcripts: add source (ENUM manual_upload|teams_fetch),
  fetched_at (DATETIME NULL), vtt_raw (LONGTEXT NULL), parsed_text (LONGTEXT NULL)
"""
from alembic import op
import sqlalchemy as sa

revision = "v2w3x4y5z6a7"
down_revision = "u7v8w9x0y1z2"
branch_labels = None
depends_on = None


def upgrade():
    # --- ai_interview_scores ---
    with op.batch_alter_table("ai_interview_scores") as batch_op:
        batch_op.add_column(
            sa.Column("report_distributed", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch_op.add_column(
            sa.Column("distributed_at", sa.DateTime(), nullable=True)
        )
        batch_op.add_column(
            sa.Column("distribution_log", sa.JSON(), nullable=True)
        )

    # --- feedback_validations ---
    with op.batch_alter_table("feedback_validations") as batch_op:
        batch_op.add_column(
            sa.Column("distribution_triggered", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch_op.add_column(
            sa.Column("distributed_at", sa.DateTime(), nullable=True)
        )
        batch_op.add_column(
            sa.Column("distributed_to", sa.JSON(), nullable=True)
        )

    # --- interview_transcripts ---
    with op.batch_alter_table("interview_transcripts") as batch_op:
        batch_op.add_column(
            sa.Column(
                "source",
                sa.Enum("manual_upload", "teams_fetch", name="transcript_source_enum"),
                nullable=False,
                server_default="manual_upload",
            )
        )
        batch_op.add_column(
            sa.Column("fetched_at", sa.DateTime(), nullable=True)
        )
        batch_op.add_column(
            sa.Column("vtt_raw", sa.Text().with_variant(sa.dialects.mysql.LONGTEXT(), "mysql"), nullable=True)
        )
        batch_op.add_column(
            sa.Column("parsed_text", sa.Text().with_variant(sa.dialects.mysql.LONGTEXT(), "mysql"), nullable=True)
        )


def downgrade():
    # --- interview_transcripts ---
    with op.batch_alter_table("interview_transcripts") as batch_op:
        batch_op.drop_column("parsed_text")
        batch_op.drop_column("vtt_raw")
        batch_op.drop_column("fetched_at")
        batch_op.drop_column("source")

    # --- feedback_validations ---
    with op.batch_alter_table("feedback_validations") as batch_op:
        batch_op.drop_column("distributed_to")
        batch_op.drop_column("distributed_at")
        batch_op.drop_column("distribution_triggered")

    # --- ai_interview_scores ---
    with op.batch_alter_table("ai_interview_scores") as batch_op:
        batch_op.drop_column("distribution_log")
        batch_op.drop_column("distributed_at")
        batch_op.drop_column("report_distributed")

    # Drop the enum type (needed for PostgreSQL; no-op on MySQL)
    op.execute("DROP TYPE IF EXISTS transcript_source_enum")
