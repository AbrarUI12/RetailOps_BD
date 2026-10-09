from httpx import AsyncClient

from tests.conftest import DatabaseHarness
from tests.test_operations_workflows import create_order, owner_headers, stock_of, stocked_variant


async def ready_order_with_shipment(
    client: AsyncClient, headers: dict[str, str], variant_id: str
) -> str:
    order_id = await create_order(client, headers, variant_id)
    await client.post(f"/api/v1/orders/{order_id}/confirm", headers=headers)
    for target in ("PACKING", "READY_FOR_SHIPMENT"):
        await client.post(
            f"/api/v1/orders/{order_id}/transition", headers=headers, json={"status": target}
        )
    shipment = await client.post(f"/api/v1/orders/{order_id}/shipment", headers=headers)
    assert shipment.status_code == 200
    assert [event["status"] for event in shipment.json()["events"]] == ["CREATED"]
    return order_id


async def courier_update(
    client: AsyncClient, headers: dict[str, str], order_id: str, status: str
) -> dict[str, object]:
    response = await client.post(
        f"/api/v1/orders/{order_id}/shipment/events", headers=headers, json={"status": status}
    )
    assert response.status_code == 200
    body: dict[str, object] = response.json()
    return body


async def test_courier_updates_drive_order_to_delivery(db_client: DatabaseHarness) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    variant_id = await stocked_variant(client, headers, 10)
    order_id = await ready_order_with_shipment(client, headers, variant_id)

    picked = await courier_update(client, headers, order_id, "PICKED_UP")
    assert picked["order_status"] == "SHIPPED"
    assert await stock_of(client, headers, variant_id) == {
        "physical": 8,
        "reserved": 0,
        "available": 8,
    }
    await courier_update(client, headers, order_id, "IN_TRANSIT")
    delivered = await courier_update(client, headers, order_id, "DELIVERED")

    assert delivered["order_status"] == "DELIVERED"
    assert delivered["status"] == "DELIVERED"
    timeline = await client.get(f"/api/v1/orders/{order_id}/shipment", headers=headers)
    assert [event["status"] for event in timeline.json()["events"]] == [
        "CREATED",
        "PICKED_UP",
        "IN_TRANSIT",
        "DELIVERED",
    ]
    report = (await client.get("/api/v1/reports/summary", headers=headers)).json()
    assert report["courier"] == {
        "shipments": 1,
        "delivered": 1,
        "returned": 0,
        "in_transit": 0,
        "delivery_rate": 1.0,
    }


async def test_returned_parcel_is_failed_delivery_and_can_be_restocked(
    db_client: DatabaseHarness,
) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    variant_id = await stocked_variant(client, headers, 10)
    order_id = await ready_order_with_shipment(client, headers, variant_id)
    await courier_update(client, headers, order_id, "PICKED_UP")

    returned = await courier_update(client, headers, order_id, "RETURNED")
    assert returned["order_status"] == "FAILED_DELIVERY"
    restock = await client.post(
        "/api/v1/returns",
        headers=headers,
        json={
            "order_id": order_id,
            "reason": "RTO — customer unreachable",
            "items": [{"variant_id": variant_id, "quantity": 2, "disposition": "SELLABLE"}],
        },
    )

    assert restock.status_code == 201
    assert (await stock_of(client, headers, variant_id))["physical"] == 10


async def test_repeated_courier_update_is_recorded_once(db_client: DatabaseHarness) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    variant_id = await stocked_variant(client, headers, 10)
    order_id = await ready_order_with_shipment(client, headers, variant_id)

    await courier_update(client, headers, order_id, "PICKED_UP")
    repeated = await courier_update(client, headers, order_id, "PICKED_UP")

    events = repeated["events"]
    assert isinstance(events, list)
    assert len(events) == 2
    assert (await stock_of(client, headers, variant_id))["physical"] == 8

    stale = await courier_update(client, headers, order_id, "CREATED")
    assert stale["status"] == "PICKED_UP"
    assert len(stale["events"]) == 2


async def test_shipment_requires_ready_order(db_client: DatabaseHarness) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    variant_id = await stocked_variant(client, headers, 10)
    order_id = await create_order(client, headers, variant_id)

    response = await client.post(f"/api/v1/orders/{order_id}/shipment", headers=headers)
    missing = await client.get(f"/api/v1/orders/{order_id}/shipment", headers=headers)

    assert response.status_code == 409
    assert missing.status_code == 404


async def test_canonical_shipment_endpoints_refresh_cancel_and_rebook(
    db_client: DatabaseHarness,
) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    variant_id = await stocked_variant(client, headers, 10)
    order_id = await ready_order_with_shipment(client, headers, variant_id)
    current = (await client.get(f"/api/v1/orders/{order_id}/shipment", headers=headers)).json()

    detail = await client.get(f"/api/v1/shipments/{current['id']}", headers=headers)
    refreshed = await client.post(f"/api/v1/shipments/{current['id']}/refresh", headers=headers)
    cancelled = await client.post(f"/api/v1/shipments/{current['id']}/cancel", headers=headers)
    rebooked = await client.post(f"/api/v1/orders/{order_id}/shipment", headers=headers)

    assert detail.status_code == refreshed.status_code == cancelled.status_code == 200
    assert cancelled.json()["status"] == "CANCELLED"
    assert [event["status"] for event in cancelled.json()["events"]] == [
        "CREATED",
        "CANCELLED",
    ]
    assert rebooked.status_code == 200
    assert rebooked.json()["status"] == "CREATED"
    assert rebooked.json()["tracking_code"] != current["tracking_code"]


async def test_picked_up_shipment_cannot_be_cancelled(db_client: DatabaseHarness) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    variant_id = await stocked_variant(client, headers, 10)
    order_id = await ready_order_with_shipment(client, headers, variant_id)
    picked = await courier_update(client, headers, order_id, "PICKED_UP")

    response = await client.post(f"/api/v1/shipments/{picked['id']}/cancel", headers=headers)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "SHIPMENT_CANNOT_CANCEL"
