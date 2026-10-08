import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, update

from app.core.permissions import ROLE_PERMISSIONS
from app.models.entities import (
    AuditLog,
    Category,
    Customer,
    Organization,
    Payment,
    ProductVariant,
    Sale,
    SyncConflict,
    UserRole,
)
from tests.conftest import DatabaseHarness
from tests.test_api_workflows import login
from tests.test_operations_workflows import (
    create_order,
    offline_sale,
    owner_headers,
    stock_of,
    stocked_variant,
)


async def cashier_headers(db_client: DatabaseHarness) -> dict[str, str]:
    auth = await login(db_client.client, "cashier@retailopsbd.com")
    return {"Authorization": f"Bearer {auth['access_token']}"}


def cash_sale(variant_id: str, quantity: int, **extra: object) -> dict[str, object]:
    return {
        "items": [{"variant_id": variant_id, "quantity": quantity}],
        "payment_method": "CASH",
        "amount_received": f"{quantity * 1000}.00",
        **extra,
    }


async def test_online_sale_cannot_bypass_the_stock_check(db_client: DatabaseHarness) -> None:
    owner = await owner_headers(db_client.client)
    variant_id = await stocked_variant(db_client.client, owner, 1)

    response = await db_client.client.post(
        "/api/v1/pos/sales",
        headers=await cashier_headers(db_client),
        json=cash_sale(variant_id, 2, allow_inventory_conflict=True),
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "INSUFFICIENT_STOCK"
    assert (await stock_of(db_client.client, owner, variant_id))["physical"] == 1


async def test_generic_transition_enforces_confirm_permission(
    db_client: DatabaseHarness, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = await owner_headers(db_client.client)
    variant_id = await stocked_variant(db_client.client, owner, 5)
    order_id = await create_order(db_client.client, owner, variant_id)
    monkeypatch.setitem(
        ROLE_PERMISSIONS, UserRole.CASHIER, {"order:read", "order:write", "product:read"}
    )

    response = await db_client.client.post(
        f"/api/v1/orders/{order_id}/transition",
        headers=await cashier_headers(db_client),
        json={"status": "CONFIRMED"},
    )

    assert response.status_code == 403
    assert (await stock_of(db_client.client, owner, variant_id))["reserved"] == 0


async def test_sale_rejects_another_tenants_customer(db_client: DatabaseHarness) -> None:
    owner = await owner_headers(db_client.client)
    variant_id = await stocked_variant(db_client.client, owner, 5)
    async with db_client.sessions() as session:
        other = Organization(name="Other Shop", slug="other-shop")
        session.add(other)
        await session.flush()
        stranger = Customer(
            organization_id=other.id,
            name="Not Ours",
            phone="01811111111",
            normalized_phone="+8801811111111",
        )
        session.add(stranger)
        await session.commit()
        stranger_id = str(stranger.id)

    response = await db_client.client.post(
        "/api/v1/pos/sales", headers=owner, json=cash_sale(variant_id, 1, customer_id=stranger_id)
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "CUSTOMER_NOT_FOUND"


async def test_split_payment_applies_change_to_cash(db_client: DatabaseHarness) -> None:
    owner = await owner_headers(db_client.client)
    variant_id = await stocked_variant(db_client.client, owner, 5)

    response = await db_client.client.post(
        "/api/v1/pos/sales",
        headers=owner,
        json={
            "items": [{"variant_id": variant_id, "quantity": 2}],
            "payment_method": "SPLIT",
            "amount_received": "0",
            "payments": [
                {"method": "BKASH", "amount": "1500.00"},
                {"method": "CASH", "amount": "1000.00"},
            ],
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["payment_method"] == "SPLIT"
    assert body["amount_received"] == "2500.00"
    assert body["change_due"] == "500.00"
    assert body["payments"] == [
        {"method": "BKASH", "amount": "1500.00"},
        {"method": "CASH", "amount": "500.00"},
    ]
    async with db_client.sessions() as session:
        applied = sum(p.amount for p in await session.scalars(select(Payment)))
        assert str(applied) == "2000.00"


async def test_non_cash_overpayment_is_rejected(db_client: DatabaseHarness) -> None:
    owner = await owner_headers(db_client.client)
    variant_id = await stocked_variant(db_client.client, owner, 5)

    response = await db_client.client.post(
        "/api/v1/pos/sales",
        headers=owner,
        json={**cash_sale(variant_id, 1), "payment_method": "CARD", "amount_received": "1500.00"},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "OVERPAID_NON_CASH"


async def test_offline_sale_keeps_its_time_and_paid_price(db_client: DatabaseHarness) -> None:
    owner = await owner_headers(db_client.client)
    variant_id = await stocked_variant(db_client.client, owner, 5)
    sold_at = datetime.now(UTC) - timedelta(days=2)
    transaction = offline_sale(variant_id, 1)
    transaction["payload"] = {
        "items": [{"variant_id": variant_id, "quantity": 1, "unit_price": "900.00"}],
        "payment_method": "CASH",
        "amount_received": "900.00",
        "offline_created_at": sold_at.isoformat(),
    }

    response = await db_client.client.post("/api/v1/sync/sales", headers=owner, json=transaction)

    assert response.status_code == 200
    assert response.json()["status"] == "CONFLICT"
    async with db_client.sessions() as session:
        sale = await session.scalar(select(Sale))
        assert sale is not None
        assert str(sale.total) == "900.00"
        assert abs(sale.created_at.replace(tzinfo=UTC) - sold_at) < timedelta(seconds=1)
        assert sale.synced_at is not None
        conflict = await session.scalar(select(SyncConflict))
        assert conflict is not None
        assert conflict.conflict_type == "PRICE_MISMATCH"
        assert conflict.details["lines"][0]["paid"] == "900.00"


async def test_offline_sale_of_a_since_deactivated_variant_is_imported(
    db_client: DatabaseHarness,
) -> None:
    owner = await owner_headers(db_client.client)
    variant_id = await stocked_variant(db_client.client, owner, 5)
    async with db_client.sessions() as session:
        await session.execute(update(ProductVariant).values(is_active=False))
        await session.commit()

    response = await db_client.client.post(
        "/api/v1/sync/sales", headers=owner, json=offline_sale(variant_id, 1)
    )

    assert response.json()["status"] == "SYNCED"
    assert (await stock_of(db_client.client, owner, variant_id))["physical"] == 4


async def test_oversell_conflict_names_the_lines(db_client: DatabaseHarness) -> None:
    owner = await owner_headers(db_client.client)
    variant_id = await stocked_variant(db_client.client, owner, 1)

    await db_client.client.post(
        "/api/v1/sync/sales", headers=owner, json=offline_sale(variant_id, 3)
    )

    conflicts = (await db_client.client.get("/api/v1/sync/conflicts", headers=owner)).json()
    line = conflicts[0]["details"]["lines"][0]
    assert line["stock_before"] == 1
    assert line["stock_after"] == -2
    assert line["quantity_sold"] == 3


async def test_validation_errors_use_the_error_envelope(db_client: DatabaseHarness) -> None:
    owner = await owner_headers(db_client.client)

    response = await db_client.client.post("/api/v1/pos/sales", headers=owner, json={})

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert {"field": "items", "message": "Field required"} in error["details"]["fields"]


async def test_unknown_route_uses_the_error_envelope(db_client: DatabaseHarness) -> None:
    response = await db_client.client.get("/api/v1/nope")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "HTTP_404"


async def test_returns_cannot_exceed_what_was_sold(db_client: DatabaseHarness) -> None:
    owner = await owner_headers(db_client.client)
    variant_id = await stocked_variant(db_client.client, owner, 5)
    sale = await db_client.client.post(
        "/api/v1/pos/sales", headers=owner, json=cash_sale(variant_id, 1)
    )
    line = {"variant_id": variant_id, "quantity": 1, "disposition": "SELLABLE"}

    first = await db_client.client.post(
        "/api/v1/returns",
        headers=owner,
        json={"sale_id": sale.json()["id"], "reason": "Changed mind", "items": [line]},
    )
    second = await db_client.client.post(
        "/api/v1/returns",
        headers=owner,
        json={"sale_id": sale.json()["id"], "reason": "Again", "items": [line]},
    )
    unsold = await db_client.client.post(
        "/api/v1/returns",
        headers=owner,
        json={
            "sale_id": sale.json()["id"],
            "reason": "Wrong item",
            "items": [{**line, "variant_id": str(uuid.uuid4())}],
        },
    )

    assert first.status_code == 201
    assert first.json()["items"] == [line]
    assert second.status_code == 422
    assert second.json()["error"]["code"] == "RETURN_EXCEEDS_SOLD"
    assert unsold.status_code == 422
    assert (await stock_of(db_client.client, owner, variant_id))["physical"] == 5
    listed = await db_client.client.get(
        "/api/v1/returns", headers=owner, params={"sale_id": sale.json()["id"]}
    )
    assert len(listed.json()) == 1


async def test_unshipped_order_cannot_be_returned(db_client: DatabaseHarness) -> None:
    owner = await owner_headers(db_client.client)
    variant_id = await stocked_variant(db_client.client, owner, 5)
    order_id = await create_order(db_client.client, owner, variant_id)

    response = await db_client.client.post(
        "/api/v1/returns",
        headers=owner,
        json={
            "order_id": order_id,
            "reason": "Never left",
            "items": [{"variant_id": variant_id, "quantity": 2, "disposition": "SELLABLE"}],
        },
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "ORDER_NOT_RETURNABLE"
    assert (await stock_of(db_client.client, owner, variant_id))["physical"] == 5


async def test_category_update_is_tenant_checked_and_audited(db_client: DatabaseHarness) -> None:
    owner = await owner_headers(db_client.client)
    product = await db_client.client.post(
        "/api/v1/products",
        headers=owner,
        json={
            "name": "Kurti",
            "sku": "KURTI",
            "variants": [{"name": "Default", "sku": "KURTI-1", "price": "800.00"}],
        },
    )
    product_id = product.json()["id"]
    async with db_client.sessions() as session:
        organization_id = await session.scalar(select(Organization.id))
        category = Category(organization_id=organization_id, name="Apparel", slug="apparel")
        session.add(category)
        await session.commit()
        category_id = str(category.id)

    foreign = await db_client.client.patch(
        f"/api/v1/products/{product_id}", headers=owner, json={"category_id": str(uuid.uuid4())}
    )
    updated = await db_client.client.patch(
        f"/api/v1/products/{product_id}",
        headers={**owner, "X-Request-ID": "req-123"},
        json={"category_id": category_id},
    )

    assert foreign.status_code == 404
    assert updated.status_code == 200
    async with db_client.sessions() as session:
        audit = await session.scalar(select(AuditLog).where(AuditLog.action == "product.updated"))
        assert audit is not None
        assert audit.new_data == {"category_id": category_id}
        assert audit.request_id == "req-123"
