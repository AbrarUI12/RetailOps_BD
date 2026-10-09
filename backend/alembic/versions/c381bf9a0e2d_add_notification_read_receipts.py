"""add per-user notification read receipts

Revision ID: c381bf9a0e2d
Revises: 8c9214d0f9a1
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c381bf9a0e2d"
down_revision: str | None = "8c9214d0f9a1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "notification_reads",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("notification_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["notification_id"], ["notifications.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("notification_id", "user_id"),
    )
    op.create_index(
        op.f("ix_notification_reads_notification_id"),
        "notification_reads",
        ["notification_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_notification_reads_organization_id"),
        "notification_reads",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_notification_reads_user_id"),
        "notification_reads",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_notification_reads_user_id"), table_name="notification_reads")
    op.drop_index(op.f("ix_notification_reads_organization_id"), table_name="notification_reads")
    op.drop_index(op.f("ix_notification_reads_notification_id"), table_name="notification_reads")
    op.drop_table("notification_reads")
