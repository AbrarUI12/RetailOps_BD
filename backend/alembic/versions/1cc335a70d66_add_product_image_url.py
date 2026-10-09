"""add product image url

Revision ID: 1cc335a70d66
Revises: 7b3e9c1a2d40
Create Date: 2026-10-09 03:30:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "1cc335a70d66"
down_revision: str | None = "7b3e9c1a2d40"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("products", sa.Column("image_url", sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column("products", "image_url")
