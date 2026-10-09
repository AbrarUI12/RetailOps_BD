from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select, update

from app.models.entities import Branch, Organization, Sale
from app.utils.time import business_day_start, business_today
from tests.conftest import DatabaseHarness
from tests.test_operations_workflows import create_order, owner_headers, stocked_variant


def test_business_day_starts_at_dhaka_midnight() -> None:
    assert business_day_start(date(2026, 10, 9)) == datetime(2026, 10, 8, 18, 0, tzinfo=UTC)


async def test_summary_report_covers_sales_inventory_and_cod(db_client: DatabaseHarness) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    variant_id = await stocked_variant(client, headers, 10)
    sale = await client.post(
        "/api/v1/pos/sales",
        headers=headers,
        json={
            "items": [{"variant_id": variant_id, "quantity": 2}],
            "payment_method": "BKASH",
            "amount_received": "1900.00",
            "discount": "100.00",
        },
    )
    assert sale.status_code == 201
    order_id = await create_order(client, headers, variant_id)
    await client.post(f"/api/v1/orders/{order_id}/cancel", headers=headers)

    report = await client.get("/api/v1/reports/summary", headers=headers)

    assert report.status_code == 200
    body = report.json()
    assert body["start"] == body["end"] == business_today().isoformat()
    assert body["sales"]["transactions"] == 1
    assert body["sales"]["revenue"] == "1900.00"
    assert body["sales"]["discount"] == "100.00"
    assert body["sales"]["by_payment_method"] == {"BKASH": "1900.00"}
    assert body["top_products"][0]["quantity"] == 2
    assert body["inventory"]["units_on_hand"] == 8
    assert body["inventory"]["retail_value"] == "8000.00"
    assert body["cod"]["total"] == 1
    assert body["cod"]["by_status"] == {"CANCELLED": 1}
    assert body["cod"]["delivery_rate"] is None


async def test_sales_belong_to_the_dhaka_calendar_day(db_client: DatabaseHarness) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    variant_id = await stocked_variant(client, headers, 5)
    sale = await client.post(
        "/api/v1/pos/sales",
        headers=headers,
        json={
            "items": [{"variant_id": variant_id, "quantity": 1}],
            "payment_method": "CASH",
            "amount_received": "1000.00",
        },
    )
    # 19:00 UTC on the 8th is 01:00 on the 9th in Dhaka.
    async with db_client.sessions() as session:
        await session.execute(
            update(Sale).values(created_at=datetime(2026, 10, 8, 19, 0, tzinfo=UTC))
        )
        await session.commit()

    day_8 = await client.get(
        "/api/v1/reports/summary",
        headers=headers,
        params={"start": "2026-10-08", "end": "2026-10-08"},
    )
    day_9 = await client.get(
        "/api/v1/reports/sales.csv",
        headers=headers,
        params={"start": "2026-10-09", "end": "2026-10-09"},
    )

    assert day_8.json()["sales"]["transactions"] == 0
    assert day_9.status_code == 200
    assert day_9.headers["content-type"].startswith("text/csv")
    lines = day_9.text.strip().splitlines()
    assert lines[0].startswith("invoice_number,created_at_dhaka")
    assert lines[1].startswith(sale.json()["invoice_number"])
    assert "2026-10-09T01:00:00+06:00" in lines[1]


async def test_report_rejects_inverted_range(db_client: DatabaseHarness) -> None:
    headers = await owner_headers(db_client.client)

    response = await db_client.client.get(
        "/api/v1/reports/summary",
        headers=headers,
        params={"start": "2026-10-09", "end": "2026-10-01"},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_DATE_RANGE"


async def test_dashboard_aggregates_the_full_branch_snapshot(db_client: DatabaseHarness) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    variant_id = await stocked_variant(client, headers, 3)
    sale = await client.post(
        "/api/v1/pos/sales",
        headers=headers,
        json={
            "items": [{"variant_id": variant_id, "quantity": 1}],
            "payment_method": "CASH",
            "amount_received": "1000.00",
        },
    )
    order_id = await create_order(client, headers, variant_id)

    response = await client.get(
        "/api/v1/reports/dashboard",
        headers=headers,
        params={"start": business_today().isoformat(), "end": business_today().isoformat()},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["start"] == body["end"] == business_today().isoformat()
    assert body["kpis"] == {
        "revenue": "1000.00",
        "sales": 1,
        "orders": 1,
        "gross_profit": "1000.00",
        "average_order_value": "1000.00",
        "pending_orders": 1,
        "low_stock": 1,
    }
    assert len(body["revenue_series"]) == 6
    assert sum(float(point["revenue"]) for point in body["revenue_series"]) == 1000
    assert body["orders_by_source"] == {"FACEBOOK": 1}
    assert body["top_products"][0]["quantity"] == 1
    assert body["low_stock_items"][0]["available_quantity"] == 2
    assert body["recent_sales"][0]["id"] == sale.json()["id"]
    assert body["recent_orders"][0]["id"] == order_id
    assert body["courier_success_rate"] is None
    assert body["branches"][0]["name"] == "Test Branch"
    week = await client.get(
        "/api/v1/reports/dashboard",
        headers=headers,
        params={
            "start": (business_today() - timedelta(days=6)).isoformat(),
            "end": business_today().isoformat(),
        },
    )
    assert len(week.json()["revenue_series"]) == 7
    assert sum(float(point["revenue"]) for point in week.json()["revenue_series"]) == 1000


async def test_dashboard_branch_selector_is_tenant_scoped(db_client: DatabaseHarness) -> None:
    headers = await owner_headers(db_client.client)
    async with db_client.sessions() as session:
        organization = await session.scalar(
            select(Organization).where(Organization.slug == "test-retail")
        )
        assert organization is not None
        second = Branch(
            organization_id=organization.id,
            name="Second Branch",
            code="SECOND",
            address="Dhaka",
        )
        foreign_org = Organization(name="Foreign", slug="foreign-dashboard")
        session.add_all([second, foreign_org])
        await session.flush()
        foreign = Branch(
            organization_id=foreign_org.id,
            name="Foreign Branch",
            code="FOREIGN",
        )
        session.add(foreign)
        await session.commit()
        second_id, foreign_id = second.id, foreign.id

    selected = await db_client.client.get(
        "/api/v1/reports/dashboard", headers=headers, params={"branch_id": str(second_id)}
    )
    denied = await db_client.client.get(
        "/api/v1/reports/dashboard", headers=headers, params={"branch_id": str(foreign_id)}
    )
    assert selected.status_code == 200
    assert selected.json()["branch_id"] == str(second_id)
    assert selected.json()["kpis"]["revenue"] == "0.00"
    assert len(selected.json()["branches"]) == 2
    assert denied.status_code == 404
    assert denied.json()["error"]["code"] == "BRANCH_NOT_FOUND"
