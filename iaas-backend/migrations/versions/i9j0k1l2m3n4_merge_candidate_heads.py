"""merge candidate migration heads

Revision ID: i9j0k1l2m3n4
Revises: h8c9d0e1f2g3, h8i9j0k1l2m3
Create Date: 2026-05-01 19:58:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "i9j0k1l2m3n4"
down_revision = ("h8c9d0e1f2g3", "h8i9j0k1l2m3")
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
