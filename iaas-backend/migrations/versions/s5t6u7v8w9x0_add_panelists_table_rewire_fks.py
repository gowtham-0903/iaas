"""Add panelists table and rewire panel_assignments/jd_panelist_assignments/interview_scores FKs

Revision ID: s5t6u7v8w9x0
Revises: p2q3r4s5t6u7
Create Date: 2026-05-11

"""
from alembic import op
import sqlalchemy as sa

revision = "s5t6u7v8w9x0"
down_revision = "r4s5t6u7v8w9"
branch_labels = None
depends_on = None


def upgrade():
    # ── 1. Create panelists table ─────────────────────────────────────────────
    op.create_table(
        "panelists",
        sa.Column("id", sa.Integer(), nullable=False, autoincrement=True),
        sa.Column("panel_id", sa.String(20), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("skill", sa.Text(), nullable=True),
        sa.Column("email", sa.String(200), nullable=False),
        sa.Column("phone", sa.String(30), nullable=True),
        sa.Column("location", sa.String(200), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("panel_id", name="uq_panelists_panel_id"),
        sa.UniqueConstraint("email", name="uq_panelists_email"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_panelists_panel_id", "panelists", ["panel_id"])
    op.create_index("ix_panelists_email", "panelists", ["email"])

    # ── 2. Rewire panel_assignments ───────────────────────────────────────────
    # Drop FK constraint from panel_assignments.panelist_id → users.id
    # MySQL names the FK automatically; use batch mode to handle it safely
    with op.batch_alter_table("panel_assignments") as batch_op:
        # Drop existing FK on panelist_id (name may vary; drop by column reference)
        batch_op.drop_constraint("panel_assignments_ibfk_2", type_="foreignkey")
        # Delete rows whose panelist_id references users (old PANELIST user rows)
    op.execute("DELETE FROM panel_assignments")
    with op.batch_alter_table("panel_assignments") as batch_op:
        batch_op.create_foreign_key(
            "fk_panel_assignments_panelist",
            "panelists",
            ["panelist_id"],
            ["id"],
            ondelete="CASCADE",
        )

    # ── 3. Rewire jd_panelist_assignments ─────────────────────────────────────
    with op.batch_alter_table("jd_panelist_assignments") as batch_op:
        batch_op.drop_constraint("jd_panelist_assignments_ibfk_2", type_="foreignkey")
    op.execute("DELETE FROM jd_panelist_assignments")
    with op.batch_alter_table("jd_panelist_assignments") as batch_op:
        batch_op.create_foreign_key(
            "fk_jd_panelist_assignments_panelist",
            "panelists",
            ["panelist_id"],
            ["id"],
            ondelete="CASCADE",
        )

    # ── 4. Rewire interview_scores ────────────────────────────────────────────
    with op.batch_alter_table("interview_scores") as batch_op:
        batch_op.drop_constraint("interview_scores_ibfk_2", type_="foreignkey")
    op.execute("DELETE FROM interview_scores")
    with op.batch_alter_table("interview_scores") as batch_op:
        batch_op.create_foreign_key(
            "fk_interview_scores_panelist",
            "panelists",
            ["panelist_id"],
            ["id"],
            ondelete="CASCADE",
        )


def downgrade():
    # Reverse: drop panelists FK, restore users FK, drop panelists table
    with op.batch_alter_table("interview_scores") as batch_op:
        batch_op.drop_constraint("fk_interview_scores_panelist", type_="foreignkey")
        batch_op.create_foreign_key(
            "interview_scores_ibfk_2", "users", ["panelist_id"], ["id"]
        )

    with op.batch_alter_table("jd_panelist_assignments") as batch_op:
        batch_op.drop_constraint("fk_jd_panelist_assignments_panelist", type_="foreignkey")
        batch_op.create_foreign_key(
            "jd_panelist_assignments_ibfk_2", "users", ["panelist_id"], ["id"]
        )

    with op.batch_alter_table("panel_assignments") as batch_op:
        batch_op.drop_constraint("fk_panel_assignments_panelist", type_="foreignkey")
        batch_op.create_foreign_key(
            "panel_assignments_ibfk_2", "users", ["panelist_id"], ["id"]
        )

    op.drop_index("ix_panelists_email", "panelists")
    op.drop_index("ix_panelists_panel_id", "panelists")
    op.drop_table("panelists")
