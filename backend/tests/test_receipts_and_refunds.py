from decimal import Decimal

from sqlalchemy import select

from app.models.entities import AuditLog, Branch, Organization, Role, Sale, User, UserRole
from tests.conftest import DatabaseHarness
from tests.test_operations_workflows import owner_headers, stock_of, stocked_variant


async def create_sale(
    db_client: DatabaseHarness, headers: dict[str, str], quantity: int = 3
) -> dict:
    variant_id = await stocked_variant(db_client.client, headers, 5)
    response = await db_client.client.post(
        "/api/v1/pos/sales",
        headers=headers,
        json={
            "items": [{"variant_id": variant_id, "quantity": quantity}],
            "payment_method": "BKASH",
            "amount_received": f"{quantity * 1000}.00",
        },
    )
    assert response.status_code == 201
    return response.json()


async def test_sales_ledger_and_detail_are_receipt_complete(db_client: DatabaseHarness) -> None:
    headers = await owner_headers(db_client.client)
    sale = await create_sale(db_client, headers)

    ledger = await db_client.client.get(
        "/api/v1/pos/sales",
        headers=headers,
        params={"search": sale["invoice_number"][4:12]},
    )

    assert ledger.status_code == 200
    assert ledger.json()["total"] == 1
    row = ledger.json()["items"][0]
    assert row["invoice_number"] == sale["invoice_number"]
    assert row["cashier_name"] == "Owner User"
    assert row["item_count"] == 3
    assert row["payment_method"] == "BKASH"
    assert row["returned_quantity"] == 0

    detail = await db_client.client.get(f"/api/v1/pos/sales/{sale['id']}", headers=headers)
    assert detail.status_code == 200
    body = detail.json()
    assert body["cashier_name"] == "Owner User"
    assert body["subtotal"] == "3000.00"
    assert body["discount"] == "0.00"
    assert body["payments"] == [{"method": "BKASH", "amount": "3000.00"}]
    assert body["items"][0]["unit_price"] == "1000.00"
    assert body["items"][0]["returned_quantity"] == 0


async def test_partial_sale_refund_restocks_and_limits_remaining_quantity(
    db_client: DatabaseHarness,
) -> None:
    headers = await owner_headers(db_client.client)
    sale = await create_sale(db_client, headers)
    variant_id = sale["items"][0]["variant_id"]
    assert (await stock_of(db_client.client, headers, variant_id))["physical"] == 2

    refunded = await db_client.client.post(
        f"/api/v1/pos/sales/{sale['id']}/refund",
        headers=headers,
        json={
            "reason": "Customer changed their mind",
            "items": [{"variant_id": variant_id, "quantity": 1, "disposition": "SELLABLE"}],
        },
    )

    assert refunded.status_code == 201
    assert refunded.json()["sale_id"] == sale["id"]
    assert (await stock_of(db_client.client, headers, variant_id))["physical"] == 3
    detail = await db_client.client.get(f"/api/v1/pos/sales/{sale['id']}", headers=headers)
    assert detail.json()["items"][0]["returned_quantity"] == 1
    ledger = await db_client.client.get("/api/v1/pos/sales", headers=headers)
    assert ledger.json()["items"][0]["returned_quantity"] == 1

    too_many = await db_client.client.post(
        f"/api/v1/pos/sales/{sale['id']}/refund",
        headers=headers,
        json={
            "reason": "Trying to return too many",
            "items": [{"variant_id": variant_id, "quantity": 3, "disposition": "SELLABLE"}],
        },
    )
    assert too_many.status_code == 422
    assert too_many.json()["error"]["code"] == "RETURN_EXCEEDS_SOLD"
    assert (await stock_of(db_client.client, headers, variant_id))["physical"] == 3
    async with db_client.sessions() as session:
        audit = await session.scalar(select(AuditLog).where(AuditLog.action == "return.received"))
        assert audit is not None
        assert audit.new_data["sale_id"] == sale["id"]


async def test_cashier_cannot_refund_a_sale(db_client: DatabaseHarness) -> None:
    owner = await owner_headers(db_client.client)
    sale = await create_sale(db_client, owner, quantity=1)
    login = await db_client.client.post(
        "/api/v1/auth/login",
        json={"email": "cashier@retailopsbd.com", "password": "RetailOps123!"},
    )
    cashier = {"Authorization": f"Bearer {login.json()['access_token']}"}
    denied = await db_client.client.post(
        f"/api/v1/pos/sales/{sale['id']}/refund",
        headers=cashier,
        json={
            "reason": "No manager approval",
            "items": [
                {
                    "variant_id": sale["items"][0]["variant_id"],
                    "quantity": 1,
                    "disposition": "SELLABLE",
                }
            ],
        },
    )
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "FORBIDDEN"


async def test_sales_history_detail_and_refund_are_tenant_scoped(
    db_client: DatabaseHarness,
) -> None:
    headers = await owner_headers(db_client.client)
    own_sale = await create_sale(db_client, headers, quantity=1)
    async with db_client.sessions() as session:
        other = Organization(name="Other Retailer", slug="other-retailer")
        session.add(other)
        await session.flush()
        branch = Branch(organization_id=other.id, name="Other Branch", code="OTHER")
        role = Role(organization_id=other.id, name=UserRole.OWNER)
        session.add_all([branch, role])
        await session.flush()
        cashier = User(
            organization_id=other.id,
            branch_id=branch.id,
            role_id=role.id,
            email="owner@other.example",
            full_name="Other Owner",
            password_hash="not-used",
        )
        session.add(cashier)
        await session.flush()
        foreign_sale = Sale(
            organization_id=other.id,
            branch_id=branch.id,
            cashier_id=cashier.id,
            invoice_number="POS-FOREIGN-0001",
            subtotal=Decimal("10.00"),
            discount=Decimal("0.00"),
            total=Decimal("10.00"),
            amount_received=Decimal("10.00"),
        )
        session.add(foreign_sale)
        await session.commit()
        foreign_id = foreign_sale.id

    ledger = await db_client.client.get("/api/v1/pos/sales", headers=headers)
    assert ledger.json()["total"] == 1
    assert ledger.json()["items"][0]["id"] == own_sale["id"]
    detail = await db_client.client.get(f"/api/v1/pos/sales/{foreign_id}", headers=headers)
    assert detail.status_code == 404
    refund = await db_client.client.post(
        f"/api/v1/pos/sales/{foreign_id}/refund",
        headers=headers,
        json={
            "reason": "Cross tenant attempt",
            "items": [
                {
                    "variant_id": own_sale["items"][0]["variant_id"],
                    "quantity": 1,
                    "disposition": "SELLABLE",
                }
            ],
        },
    )
    assert refund.status_code == 404
    assert refund.json()["error"]["code"] == "SALE_NOT_FOUND"
