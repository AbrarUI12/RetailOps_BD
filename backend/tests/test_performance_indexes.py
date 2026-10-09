from app.core.database import Base


def test_tenant_timeline_queries_have_composite_indexes() -> None:
    expected = {
        "audit_logs": "ix_audit_logs_org_created_at",
        "customers": "ix_customers_org_created_at",
        "notifications": "ix_notifications_org_created_at",
        "orders": "ix_orders_org_created_at",
        "purchases": "ix_purchases_org_created_at",
        "returns": "ix_returns_org_created_at",
        "sales": "ix_sales_org_created_at",
        "sync_conflicts": "ix_sync_conflicts_org_created_at",
    }

    for table_name, index_name in expected.items():
        index = next(
            index for index in Base.metadata.tables[table_name].indexes if index.name == index_name
        )
        assert [column.name for column in index.columns] == ["organization_id", "created_at"]
