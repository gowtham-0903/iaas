"""enforce recruiter client integrity

Revision ID: e5f6g7h8i9j0
Revises: d4e7f1a2b3c4
Create Date: 2026-04-24

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e5f6g7h8i9j0'
down_revision = 'd4e7f1a2b3c4'
branch_labels = None
depends_on = None


def _index_exists(table_name: str, index_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    indexes = inspector.get_indexes(table_name)
    return any(index.get('name') == index_name for index in indexes)


def upgrade():
    if not _index_exists('users', 'ix_users_client_id'):
        op.create_index('ix_users_client_id', 'users', ['client_id'])


def downgrade():
    if _index_exists('users', 'ix_users_client_id'):
        op.drop_index('ix_users_client_id', table_name='users')
