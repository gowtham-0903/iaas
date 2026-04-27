"""add operator to users_role_enum

Revision ID: f1a2b3c4d5e6
Revises: e5f6g7h8i9j0
Create Date: 2026-04-27 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'f1a2b3c4d5e6'
down_revision = 'e5f6g7h8i9j0'
branch_labels = None
depends_on = None


def upgrade():
    # MySQL requires raw SQL for enum modifications
    op.execute("ALTER TABLE users MODIFY role ENUM('ADMIN', 'M_RECRUITER', 'SR_RECRUITER', 'RECRUITER', 'PANELIST', 'QC', 'CLIENT', 'OPERATOR') NOT NULL")


def downgrade():
    op.execute("ALTER TABLE users MODIFY role ENUM('ADMIN', 'M_RECRUITER', 'SR_RECRUITER', 'RECRUITER', 'PANELIST', 'QC', 'CLIENT') NOT NULL")
