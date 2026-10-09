"""add sync conflict resolution metadata

Revision ID: 8c9214d0f9a1
Revises: 4af17dd3e0c2
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "8c9214d0f9a1"
down_revision: str | None = "4af17dd3e0c2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("sync_conflicts", sa.Column("reviewed_by", sa.Uuid(), nullable=True))
    op.add_column("sync_conflicts", sa.Column("resolution", sa.String(length=40), nullable=True))
    op.add_column("sync_conflicts", sa.Column("resolution_note", sa.Text(), nullable=True))
    op.create_foreign_key(
        op.f("fk_sync_conflicts_reviewed_by_users"),
        "sync_conflicts",
        "users",
        ["reviewed_by"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("fk_sync_conflicts_reviewed_by_users"), "sync_conflicts", type_="foreignkey"
    )
    op.drop_column("sync_conflicts", "resolution_note")
    op.drop_column("sync_conflicts", "resolution")
    op.drop_column("sync_conflicts", "reviewed_by")
