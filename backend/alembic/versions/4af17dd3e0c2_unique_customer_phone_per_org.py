"""unique customer phone per organization

Revision ID: 4af17dd3e0c2
Revises: 1cc335a70d66
Create Date: 2026-10-09 19:00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "4af17dd3e0c2"
down_revision: str | None = "1cc335a70d66"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index("ix_customers_org_phone", table_name="customers")
    op.create_unique_constraint(
        "uq_customers_org_phone", "customers", ["organization_id", "normalized_phone"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_customers_org_phone", "customers", type_="unique")
    op.create_index(
        "ix_customers_org_phone",
        "customers",
        ["organization_id", "normalized_phone"],
        unique=False,
    )
