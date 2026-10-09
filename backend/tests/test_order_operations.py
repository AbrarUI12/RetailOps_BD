from app.utils.time import business_today
from tests.conftest import DatabaseHarness
from tests.test_operations_workflows import create_order, owner_headers, stock_of, stocked_variant


async def test_operational_order_filters_and_detail_show_reservation_history(
    db_client: DatabaseHarness,
) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    variant_id = await stocked_variant(client, headers, 10)
    order_id = await create_order(client, headers, variant_id)

    by_source = await client.get("/api/v1/orders", headers=headers, params={"source": "FACEBOOK"})
    by_phone = await client.get(
        "/api/v1/orders", headers=headers, params={"search": "01712 345678"}
    )
    by_date = await client.get(
        "/api/v1/orders",
        headers=headers,
        params={
            "created_from": business_today().isoformat(),
            "created_to": business_today().isoformat(),
        },
    )
    empty = await client.get("/api/v1/orders", headers=headers, params={"status": "DELIVERED"})
    assert [order["id"] for order in by_source.json()] == [order_id]
    assert [order["id"] for order in by_phone.json()] == [order_id]
    assert [order["id"] for order in by_date.json()] == [order_id]
    assert empty.json() == []

    confirmed = await client.post(f"/api/v1/orders/{order_id}/confirm", headers=headers)
    detail = await client.get(f"/api/v1/orders/{order_id}", headers=headers)

    assert confirmed.status_code == 200
    assert detail.status_code == 200
    payload = detail.json()
    assert payload["customer"]["name"] == "Nusrat Jahan"
    assert [event["to_status"] for event in payload["events"]] == [
        "PENDING_CONFIRMATION",
        "CONFIRMED",
    ]
    assert payload["reservations"] == [
        {
            "variant_id": variant_id,
            "product_name": payload["order"]["items"][0]["product_name"],
            "quantity": 2,
            "active": True,
        }
    ]
    assert payload["shipment_booked"] is False


async def test_pack_endpoint_and_shipping_guard_preserve_reservation(
    db_client: DatabaseHarness,
) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    variant_id = await stocked_variant(client, headers, 10)
    order_id = await create_order(client, headers, variant_id)
    await client.post(f"/api/v1/orders/{order_id}/confirm", headers=headers)

    packed = await client.post(f"/api/v1/orders/{order_id}/pack", headers=headers)
    ready = await client.post(
        f"/api/v1/orders/{order_id}/transition",
        headers=headers,
        json={"status": "READY_FOR_SHIPMENT"},
    )
    blocked = await client.post(
        f"/api/v1/orders/{order_id}/transition",
        headers=headers,
        json={"status": "SHIPPED"},
    )

    assert packed.json()["status"] == "PACKING"
    assert ready.json()["status"] == "READY_FOR_SHIPMENT"
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "SHIPMENT_REQUIRED"
    assert await stock_of(client, headers, variant_id) == {
        "physical": 10,
        "reserved": 2,
        "available": 8,
    }
