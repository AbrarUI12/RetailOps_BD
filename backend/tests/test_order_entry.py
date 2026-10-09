from sqlalchemy import func, select

from app.models.entities import Customer, Order, OrderItem
from tests.conftest import DatabaseHarness
from tests.test_operations_workflows import owner_headers, stocked_variant


async def test_manual_order_stores_source_totals_and_reuses_customer(
    db_client: DatabaseHarness,
) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    first_variant = await stocked_variant(client, headers, 5)
    second_variant = await stocked_variant(client, headers, 5)
    customer = await client.post(
        "/api/v1/customers",
        headers=headers,
        json={"name": "Rahim Ahmed", "phone": "01712-345678"},
    )

    response = await client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "customer_id": customer.json()["id"],
            "source": "INSTAGRAM",
            "delivery_address": "House 12, Road 4, Dhanmondi",
            "area": "Dhanmondi",
            "delivery_fee": "80.00",
            "discount": "150.00",
            "items": [
                {"variant_id": first_variant, "quantity": 2},
                {"variant_id": second_variant, "quantity": 1},
            ],
        },
    )

    assert response.status_code == 201
    assert response.json()["source"] == "INSTAGRAM"
    assert response.json()["subtotal"] == "3000.00"
    assert response.json()["total"] == "2930.00"
    assert len(response.json()["items"]) == 2
    async with db_client.sessions() as session:
        assert await session.scalar(select(func.count(Customer.id))) == 1
        assert await session.scalar(select(func.count(Order.id))) == 1
        assert await session.scalar(select(func.count(OrderItem.id))) == 2


async def test_order_can_create_then_reuse_customer_by_equivalent_phone(
    db_client: DatabaseHarness,
) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    variant_id = await stocked_variant(client, headers, 5)
    first = await client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "customer": {"name": "Nusrat Jahan", "phone": "01812-345678"},
            "delivery_address": "Road 7, Banani Model Town",
            "items": [{"variant_id": variant_id, "quantity": 1}],
        },
    )
    lookup = await client.get(
        "/api/v1/customers/lookup", headers=headers, params={"phone": "+880 1812 345678"}
    )
    second = await client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "customer_id": lookup.json()["id"],
            "delivery_address": "Road 7, Banani Model Town",
            "items": [{"variant_id": variant_id, "quantity": 1}],
        },
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["customer_id"] == second.json()["customer_id"]
    async with db_client.sessions() as session:
        assert await session.scalar(select(func.count(Customer.id))) == 1


async def test_order_rejects_unknown_and_duplicate_items(db_client: DatabaseHarness) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    variant_id = await stocked_variant(client, headers, 5)
    customer = await client.post(
        "/api/v1/customers",
        headers=headers,
        json={"name": "Order Customer", "phone": "01612345678"},
    )
    base = {
        "customer_id": customer.json()["id"],
        "delivery_address": "House 5, Uttara Sector 4",
    }
    duplicate = await client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            **base,
            "items": [
                {"variant_id": variant_id, "quantity": 1},
                {"variant_id": variant_id, "quantity": 2},
            ],
        },
    )
    unknown = await client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "customer": {"name": "Should Not Persist", "phone": "01512345678"},
            "delivery_address": base["delivery_address"],
            "items": [{"variant_id": "00000000-0000-0000-0000-000000000001", "quantity": 1}],
        },
    )

    assert duplicate.status_code == 422
    assert unknown.status_code == 422
    assert unknown.json()["error"]["code"] == "INVALID_ORDER_ITEM"
    async with db_client.sessions() as session:
        assert await session.scalar(select(func.count(Order.id))) == 0
        assert await session.scalar(select(func.count(Customer.id))) == 1
