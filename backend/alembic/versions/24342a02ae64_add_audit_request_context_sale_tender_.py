"""add audit request context, sale tender and per-org purchase reference

Revision ID: 24342a02ae64
Revises: 5d5f32c9ad04
Create Date: 2026-10-09 02:20:25.147797
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "24342a02ae64"
down_revision: str | None = "5d5f32c9ad04"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("audit_logs", sa.Column("ip_address", sa.String(length=64), nullable=True))
    op.add_column("audit_logs", sa.Column("user_agent", sa.String(length=255), nullable=True))
    op.create_index(
        "ix_orders_branch_created_at", "orders", ["branch_id", "created_at"], unique=False
    )
    # Purchase references were unique across every tenant; scope them per organization.
    op.drop_constraint(op.f("uq_purchases_reference_"), "purchases", type_="unique")
    op.create_unique_constraint(
        op.f("uq_purchases_organization_id_reference"),
        "purchases",
        ["organization_id", "reference"],
    )
    op.add_column(
        "sales",
        sa.Column(
            "amount_received",
            sa.Numeric(precision=14, scale=2),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column("sales", sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(
        "ix_sales_branch_created_at", "sales", ["branch_id", "created_at"], unique=False
    )
    # Payments used to store the cash handed over; they now store the amount applied to the sale.
    op.execute(
        """
        UPDATE sales SET amount_received = COALESCE(
            (SELECT SUM(payments.amount) FROM payments WHERE payments.sale_id = sales.id),
            sales.total
        )
        """
    )
    op.execute(
        """
        UPDATE payments
        SET amount = (SELECT sales.total FROM sales WHERE sales.id = payments.sale_id)
        WHERE payments.sale_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE payments SET amount = (
            SELECT sales.amount_received FROM sales WHERE sales.id = payments.sale_id
        )
        WHERE payments.sale_id IS NOT NULL
        """
    )
    op.drop_index("ix_sales_branch_created_at", table_name="sales")
    op.drop_column("sales", "synced_at")
    op.drop_column("sales", "amount_received")
    op.drop_constraint(op.f("uq_purchases_organization_id_reference"), "purchases", type_="unique")
    op.create_unique_constraint(op.f("uq_purchases_reference_"), "purchases", ["reference"])
    op.drop_index("ix_orders_branch_created_at", table_name="orders")
    op.drop_column("audit_logs", "user_agent")
    op.drop_column("audit_logs", "ip_address")
