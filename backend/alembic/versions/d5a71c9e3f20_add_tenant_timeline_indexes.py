"""add tenant timeline indexes

Revision ID: d5a71c9e3f20
Revises: c381bf9a0e2d
"""

from collections.abc import Sequence

from alembic import op

revision: str = "d5a71c9e3f20"
down_revision: str | None = "c381bf9a0e2d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

INDEXES = {
    "ix_audit_logs_org_created_at": "audit_logs",
    "ix_customers_org_created_at": "customers",
    "ix_notifications_org_created_at": "notifications",
    "ix_orders_org_created_at": "orders",
    "ix_purchases_org_created_at": "purchases",
    "ix_returns_org_created_at": "returns",
    "ix_sales_org_created_at": "sales",
    "ix_sync_conflicts_org_created_at": "sync_conflicts",
}


def upgrade() -> None:
    for name, table in INDEXES.items():
        op.create_index(name, table, ["organization_id", "created_at"], unique=False)


def downgrade() -> None:
    for name, table in reversed(INDEXES.items()):
        op.drop_index(name, table_name=table)
