import uuid

from httpx import AsyncClient
from sqlalchemy import func, select

from app.models.entities import (
    AuditLog,
    Branch,
    InventoryBalance,
    InventoryMovement,
    Payment,
    Sale,
    SyncConflict,
    SyncTransaction,
    User,
)
from tests.conftest import DatabaseHarness
from tests.test_api_workflows import login


async def owner_headers(client: AsyncClient) -> dict[str, str]:
    auth = await login(client)
    return {"Authorization": f"Bearer {auth['access_token']}"}


async def stocked_variant(client: AsyncClient, headers: dict[str, str], quantity: int) -> str:
    sku = uuid.uuid4().hex[:6].upper()
    product = await client.post(
        "/api/v1/products",
        headers=headers,
        json={
            "name": f"Saree {sku}",
            "sku": sku,
            "variants": [{"name": "Default", "sku": f"{sku}-1", "price": "1000.00"}],
        },
    )
    assert product.status_code == 201
    variant_id: str = product.json()["variants"][0]["id"]
    if quantity:
        adjusted = await client.post(
            "/api/v1/inventory/adjustments",
            headers=headers,
            json={
                "variant_id": variant_id,
                "quantity_delta": quantity,
                "reason": "OPENING_STOCK",
                "note": "Counted",
            },
        )
        assert adjusted.status_code == 201
    return variant_id


async def stock_of(client: AsyncClient, headers: dict[str, str], variant_id: str) -> dict[str, int]:
    row = (await client.get(f"/api/v1/inventory/{variant_id}", headers=headers)).json()["item"]
    return {
        "physical": row["physical_quantity"],
        "reserved": row["reserved_quantity"],
        "available": row["available_quantity"],
    }


def offline_sale(variant_id: str, quantity: int) -> dict[str, object]:
    return {
        "client_transaction_id": str(uuid.uuid4()),
        "device_key": "pos-1",
        "payload": {
            "items": [{"variant_id": variant_id, "quantity": quantity}],
            "payment_method": "CASH",
            "amount_received": f"{quantity * 1000}.00",
        },
    }


async def test_offline_sale_synced_twice_creates_exactly_one_sale(
    db_client: DatabaseHarness,
) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    variant_id = await stocked_variant(client, headers, 5)
    transaction = offline_sale(variant_id, 2)

    first = await client.post("/api/v1/sync/sales", headers=headers, json=transaction)
    # Simulates the client retrying after the first response was lost.
    second = await client.post("/api/v1/sync/sales", headers=headers, json=transaction)

    assert first.status_code == 200
    assert first.json()["status"] == "SYNCED"
    assert second.json()["idempotent_replay"] is True
    assert second.json()["server_record_id"] == first.json()["server_record_id"]
    async with db_client.sessions() as session:
        assert await session.scalar(select(func.count(Sale.id))) == 1
        assert await session.scalar(select(func.count(Payment.id))) == 1
        assert await session.scalar(select(func.count(SyncTransaction.id))) == 1
        sale_movements = await session.scalar(
            select(func.count(InventoryMovement.id)).where(
                InventoryMovement.reference_type == "sale"
            )
        )
        assert sale_movements == 1
    assert (await stock_of(client, headers, variant_id))["physical"] == 3

    status = await client.get(
        f"/api/v1/sync/status/{transaction['client_transaction_id']}", headers=headers
    )
    assert status.json() == {
        **second.json(),
        "idempotent_replay": False,
    }

    changed = {
        **transaction,
        "payload": {**transaction["payload"], "discount": "1.00"},
    }
    reused = await client.post("/api/v1/sync/sales", headers=headers, json=changed)
    assert reused.status_code == 409
    assert reused.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"


async def test_offline_oversell_keeps_sale_and_raises_conflict(db_client: DatabaseHarness) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    variant_id = await stocked_variant(client, headers, 1)
    transaction = offline_sale(variant_id, 3)

    response = await client.post("/api/v1/sync/sales", headers=headers, json=transaction)
    replay = await client.post("/api/v1/sync/sales", headers=headers, json=transaction)

    assert response.status_code == 200
    assert response.json()["status"] == "CONFLICT"
    assert response.json()["conflict"] is True
    assert replay.json()["server_record_id"] == response.json()["server_record_id"]
    assert replay.json()["idempotent_replay"] is True
    sale = await client.get(
        f"/api/v1/pos/sales/{response.json()['server_record_id']}", headers=headers
    )
    assert sale.status_code == 200
    conflicts = (await client.get("/api/v1/sync/conflicts", headers=headers)).json()
    assert [item["type"] for item in conflicts] == ["INVENTORY_OVERSELL"]
    assert (await stock_of(client, headers, variant_id))["physical"] == -2
    async with db_client.sessions() as session:
        assert await session.scalar(select(func.count(Sale.id))) == 1
        assert await session.scalar(select(func.count(SyncConflict.id))) == 1
        assert (
            await session.scalar(
                select(func.count(InventoryMovement.id)).where(
                    InventoryMovement.reference_type == "sale"
                )
            )
            == 1
        )

    resolved = await client.post(
        f"/api/v1/sync/conflicts/{conflicts[0]['id']}/resolve",
        headers=headers,
        json={
            "resolution": "STOCK_RECOUNT_REQUESTED",
            "note": "Warehouse will verify the physical count",
        },
    )
    assert resolved.status_code == 200
    assert resolved.json()["reviewed"] is True
    assert resolved.json()["resolution"] == "STOCK_RECOUNT_REQUESTED"
    same = await client.post(
        f"/api/v1/sync/conflicts/{conflicts[0]['id']}/resolve",
        headers=headers,
        json={
            "resolution": "STOCK_RECOUNT_REQUESTED",
            "note": "Warehouse will verify the physical count",
        },
    )
    assert same.status_code == 200
    different = await client.post(
        f"/api/v1/sync/conflicts/{conflicts[0]['id']}/resolve",
        headers=headers,
        json={"resolution": "ACKNOWLEDGED", "note": "Trying to overwrite resolution"},
    )
    assert different.status_code == 409
    async with db_client.sessions() as session:
        assert (
            await session.scalar(
                select(func.count(AuditLog.id)).where(AuditLog.action == "sync_conflict.resolved")
            )
            == 1
        )


async def test_invalid_sync_payload_is_a_permanent_validation_error(
    db_client: DatabaseHarness,
) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    transaction = offline_sale(str(uuid.uuid4()), 1)
    transaction["payload"] = {"items": [], "payment_method": "CASH"}

    response = await client.post("/api/v1/sync/sales", headers=headers, json=transaction)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_SYNC_PAYLOAD"
    async with db_client.sessions() as session:
        assert await session.scalar(select(func.count(Sale.id))) == 0
        assert await session.scalar(select(func.count(SyncConflict.id))) == 0


async def create_order(client: AsyncClient, headers: dict[str, str], variant_id: str) -> str:
    response = await client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "customer": {"name": "Nusrat Jahan", "phone": "+8801712345678"},
            "delivery_address": "House 12, Road 4, Dhanmondi",
            "area": "Dhanmondi",
            "delivery_fee": "60.00",
            "items": [{"variant_id": variant_id, "quantity": 2}],
        },
    )
    assert response.status_code == 201
    assert response.json()["status"] == "PENDING_CONFIRMATION"
    assert response.json()["total"] == "2060.00"
    order_id: str = response.json()["id"]
    return order_id


async def test_confirm_reserves_and_cancel_releases_stock(db_client: DatabaseHarness) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    variant_id = await stocked_variant(client, headers, 10)
    order_id = await create_order(client, headers, variant_id)
    assert (await stock_of(client, headers, variant_id))["reserved"] == 0

    confirmed = await client.post(f"/api/v1/orders/{order_id}/confirm", headers=headers)
    assert confirmed.json()["status"] == "CONFIRMED"
    assert await stock_of(client, headers, variant_id) == {
        "physical": 10,
        "reserved": 2,
        "available": 8,
    }

    cancelled = await client.post(f"/api/v1/orders/{order_id}/cancel", headers=headers)
    assert cancelled.json()["status"] == "CANCELLED"
    assert await stock_of(client, headers, variant_id) == {
        "physical": 10,
        "reserved": 0,
        "available": 10,
    }


async def test_shipping_consumes_reservation_into_ledger(db_client: DatabaseHarness) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    variant_id = await stocked_variant(client, headers, 10)
    order_id = await create_order(client, headers, variant_id)
    await client.post(f"/api/v1/orders/{order_id}/confirm", headers=headers)
    for target in ("PACKING", "READY_FOR_SHIPMENT"):
        moved = await client.post(
            f"/api/v1/orders/{order_id}/transition", headers=headers, json={"status": target}
        )
        assert moved.status_code == 200
    shipment = await client.post(f"/api/v1/orders/{order_id}/shipment", headers=headers)
    assert shipment.status_code == 200
    assert shipment.json()["provider"] == "MOCK_COURIER"

    shipped = await client.post(
        f"/api/v1/orders/{order_id}/transition", headers=headers, json={"status": "SHIPPED"}
    )

    assert shipped.json()["status"] == "SHIPPED"
    assert await stock_of(client, headers, variant_id) == {
        "physical": 8,
        "reserved": 0,
        "available": 8,
    }
    movements = (
        await client.get(
            "/api/v1/inventory/movements", headers=headers, params={"variant_id": variant_id}
        )
    ).json()
    assert movements[0]["movement_type"] == "ORDER_FULFILLMENT"
    assert movements[0]["quantity_delta"] == -2


async def test_illegal_transition_and_unreservable_order_are_rejected(
    db_client: DatabaseHarness,
) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    variant_id = await stocked_variant(client, headers, 1)
    order_id = await create_order(client, headers, variant_id)

    skipped = await client.post(
        f"/api/v1/orders/{order_id}/transition", headers=headers, json={"status": "SHIPPED"}
    )
    assert skipped.status_code == 409
    assert skipped.json()["error"]["code"] == "ILLEGAL_ORDER_TRANSITION"

    short = await client.post(f"/api/v1/orders/{order_id}/confirm", headers=headers)
    assert short.status_code == 409
    assert short.json()["error"]["code"] == "INSUFFICIENT_STOCK"
    assert (await stock_of(client, headers, variant_id))["reserved"] == 0


async def test_return_dispositions_have_correct_inventory_effect(
    db_client: DatabaseHarness,
) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    variant_id = await stocked_variant(client, headers, 5)
    sale = await client.post(
        "/api/v1/pos/sales",
        headers=headers,
        json={
            "items": [{"variant_id": variant_id, "quantity": 3}],
            "payment_method": "CASH",
            "amount_received": "3000.00",
        },
    )
    assert sale.status_code == 201

    returned = await client.post(
        "/api/v1/returns",
        headers=headers,
        json={
            "sale_id": sale.json()["id"],
            "reason": "Customer return",
            "items": [
                {"variant_id": variant_id, "quantity": 1, "disposition": "SELLABLE"},
                {"variant_id": variant_id, "quantity": 1, "disposition": "DAMAGED"},
                {"variant_id": variant_id, "quantity": 1, "disposition": "MISSING"},
            ],
        },
    )

    assert returned.status_code == 201
    assert (await stock_of(client, headers, variant_id))["physical"] == 3
    movements = (
        await client.get(
            "/api/v1/inventory/movements", headers=headers, params={"variant_id": variant_id}
        )
    ).json()
    effects = {
        item["movement_type"]: item["quantity_delta"]
        for item in movements
        if item["movement_type"].startswith("RETURN_")
    }
    assert effects == {"RETURN_SELLABLE": 1, "RETURN_DAMAGED": 0, "RETURN_MISSING": 0}


async def test_return_for_unknown_sale_is_rejected(db_client: DatabaseHarness) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    variant_id = await stocked_variant(client, headers, 0)

    response = await client.post(
        "/api/v1/returns",
        headers=headers,
        json={
            "sale_id": str(uuid.uuid4()),
            "reason": "Not ours",
            "items": [{"variant_id": variant_id, "quantity": 1, "disposition": "SELLABLE"}],
        },
    )

    assert response.status_code == 404
    assert (await stock_of(client, headers, variant_id))["physical"] == 0


async def test_receiving_a_purchase_twice_adds_stock_once(db_client: DatabaseHarness) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    variant_id = await stocked_variant(client, headers, 0)
    supplier = await client.post(
        "/api/v1/suppliers", headers=headers, json={"name": "Tangail Weavers"}
    )
    assert supplier.status_code == 201
    purchase = await client.post(
        "/api/v1/purchases",
        headers=headers,
        json={
            "supplier_id": supplier.json()["id"],
            "reference": "PO-1001",
            "items": [{"variant_id": variant_id, "quantity": 12, "unit_cost": "450.00"}],
        },
    )
    assert purchase.status_code == 201
    assert purchase.json()["total"] == "5400.00"
    assert purchase.json()["supplier_name"] == "Tangail Weavers"
    assert purchase.json()["items"] == [
        {
            "variant_id": variant_id,
            "product_name": purchase.json()["items"][0]["product_name"],
            "variant_name": "Default",
            "sku": purchase.json()["items"][0]["sku"],
            "quantity": 12,
            "unit_cost": "450.00",
            "line_total": "5400.00",
        }
    ]

    for _ in range(2):
        received = await client.post(
            f"/api/v1/purchases/{purchase.json()['id']}/receive", headers=headers
        )
        assert received.json()["status"] == "RECEIVED"

    assert (await stock_of(client, headers, variant_id))["physical"] == 12
    async with db_client.sessions() as session:
        movement_count = await session.scalar(
            select(func.count(InventoryMovement.id)).where(
                InventoryMovement.reference_id == uuid.UUID(purchase.json()["id"]),
                InventoryMovement.movement_type == "PURCHASE_RECEIPT",
            )
        )
    assert movement_count == 1


async def test_purchase_rejects_unknown_and_duplicate_variants(
    db_client: DatabaseHarness,
) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    variant_id = await stocked_variant(client, headers, 0)
    supplier = (
        await client.post("/api/v1/suppliers", headers=headers, json={"name": "Aarong Trade"})
    ).json()
    base = {
        "supplier_id": supplier["id"],
        "reference": "PO-VALIDATION",
        "items": [{"variant_id": variant_id, "quantity": 2, "unit_cost": "100.00"}],
    }

    unknown = await client.post(
        "/api/v1/purchases",
        headers=headers,
        json={**base, "items": [{**base["items"][0], "variant_id": str(uuid.uuid4())}]},
    )
    assert unknown.status_code == 404
    assert unknown.json()["error"]["code"] == "VARIANT_NOT_FOUND"

    duplicate = await client.post(
        "/api/v1/purchases",
        headers=headers,
        json={**base, "items": [base["items"][0], base["items"][0]]},
    )
    assert duplicate.status_code == 422
    assert duplicate.json()["error"]["code"] == "DUPLICATE_PURCHASE_ITEM"

    created = await client.post("/api/v1/purchases", headers=headers, json=base)
    assert created.status_code == 201
    repeated = await client.post("/api/v1/purchases", headers=headers, json=base)
    assert repeated.status_code == 409
    assert repeated.json()["error"]["code"] == "DUPLICATE_PURCHASE_REFERENCE"


async def test_purchase_receipt_uses_the_purchase_branch(
    db_client: DatabaseHarness,
) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    variant_id = await stocked_variant(client, headers, 0)
    supplier = (
        await client.post("/api/v1/suppliers", headers=headers, json={"name": "Branch Supplier"})
    ).json()
    purchase = (
        await client.post(
            "/api/v1/purchases",
            headers=headers,
            json={
                "supplier_id": supplier["id"],
                "reference": "PO-BRANCH",
                "items": [{"variant_id": variant_id, "quantity": 7, "unit_cost": "80.00"}],
            },
        )
    ).json()
    purchase_branch_id = uuid.UUID(purchase["branch_id"])

    async with db_client.sessions() as session:
        owner = await session.scalar(select(User).where(User.email == "owner@retailopsbd.com"))
        assert owner is not None
        other_branch = Branch(
            organization_id=owner.organization_id,
            name="Warehouse",
            code="WH",
            address="Gazipur",
        )
        session.add(other_branch)
        await session.flush()
        owner.branch_id = other_branch.id
        await session.commit()
        other_branch_id = other_branch.id

    received = await client.post(f"/api/v1/purchases/{purchase['id']}/receive", headers=headers)
    assert received.status_code == 200

    async with db_client.sessions() as session:
        balances = (
            await session.scalars(
                select(InventoryBalance).where(InventoryBalance.variant_id == uuid.UUID(variant_id))
            )
        ).all()
    assert [(balance.branch_id, balance.physical_quantity) for balance in balances] == [
        (purchase_branch_id, 7)
    ]
    assert all(balance.branch_id != other_branch_id for balance in balances)
