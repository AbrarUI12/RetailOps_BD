from decimal import Decimal

from sqlalchemy import func, select

from app.models.entities import (
    AuditLog,
    InventoryBalance,
    InventoryMovement,
    Payment,
    Sale,
    SaleItem,
)
from tests.conftest import DatabaseHarness
from tests.test_operations_workflows import owner_headers, stock_of, stocked_variant


async def test_online_sale_persists_the_complete_transaction(
    db_client: DatabaseHarness,
) -> None:
    headers = await owner_headers(db_client.client)
    variant_id = await stocked_variant(db_client.client, headers, 5)

    response = await db_client.client.post(
        "/api/v1/pos/sales",
        headers=headers,
        json={
            "items": [{"variant_id": variant_id, "quantity": 2}],
            "payment_method": "CASH",
            "amount_received": "2500.00",
            "discount": "100.00",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["invoice_number"].startswith("POS-")
    assert body["subtotal"] == "2000.00"
    assert body["discount"] == "100.00"
    assert body["total"] == "1900.00"
    assert body["amount_received"] == "2500.00"
    assert body["change_due"] == "600.00"
    assert body["payments"] == [{"method": "CASH", "amount": "1900.00"}]
    assert body["items"][0]["quantity"] == 2

    async with db_client.sessions() as session:
        sale = await session.scalar(select(Sale))
        assert sale is not None
        assert sale.invoice_number == body["invoice_number"]
        assert sale.total == Decimal("1900.00")
        assert sale.amount_received == Decimal("2500.00")

        item = await session.scalar(select(SaleItem))
        assert item is not None
        assert item.sale_id == sale.id
        assert item.quantity == 2
        assert item.line_total == Decimal("2000.00")

        payment = await session.scalar(select(Payment))
        assert payment is not None
        assert payment.sale_id == sale.id
        assert payment.amount == Decimal("1900.00")

        movement = await session.scalar(
            select(InventoryMovement).where(InventoryMovement.movement_type == "SALE")
        )
        assert movement is not None
        assert movement.reference_type == "sale"
        assert movement.reference_id == sale.id
        assert movement.quantity_delta == -2
        assert movement.previous_quantity == 5
        assert movement.new_quantity == 3

        balance = await session.scalar(
            select(InventoryBalance).where(InventoryBalance.variant_id == movement.variant_id)
        )
        assert balance is not None
        assert balance.physical_quantity == 3

        audit = await session.scalar(select(AuditLog).where(AuditLog.action == "sale.created"))
        assert audit is not None
        assert audit.entity_id == sale.id
        assert audit.new_data == {
            "invoice_number": sale.invoice_number,
            "total": "1900.00",
            "offline": False,
            "price_mismatches": None,
        }


async def test_online_sale_rolls_back_every_write_when_a_later_line_fails(
    db_client: DatabaseHarness,
) -> None:
    headers = await owner_headers(db_client.client)
    enough_variant = await stocked_variant(db_client.client, headers, 5)
    short_variant = await stocked_variant(db_client.client, headers, 1)

    response = await db_client.client.post(
        "/api/v1/pos/sales",
        headers=headers,
        json={
            "items": [
                {"variant_id": enough_variant, "quantity": 2},
                {"variant_id": short_variant, "quantity": 2},
            ],
            "payment_method": "CASH",
            "amount_received": "4000.00",
        },
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "INSUFFICIENT_STOCK"
    assert (await stock_of(db_client.client, headers, enough_variant))["physical"] == 5
    assert (await stock_of(db_client.client, headers, short_variant))["physical"] == 1

    async with db_client.sessions() as session:
        assert await session.scalar(select(func.count(Sale.id))) == 0
        assert await session.scalar(select(func.count(SaleItem.id))) == 0
        assert await session.scalar(select(func.count(Payment.id))) == 0
        assert (
            await session.scalar(
                select(func.count(InventoryMovement.id)).where(
                    InventoryMovement.movement_type == "SALE"
                )
            )
            == 0
        )
        assert (
            await session.scalar(
                select(func.count(AuditLog.id)).where(AuditLog.action == "sale.created")
            )
            == 0
        )
