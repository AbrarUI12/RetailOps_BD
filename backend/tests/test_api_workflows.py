from httpx import AsyncClient

from tests.conftest import DatabaseHarness


async def login(client: AsyncClient, email: str = "owner@retailopsbd.com") -> dict[str, object]:
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "RetailOps123!"},
    )
    assert response.status_code == 200
    return response.json()


async def test_login_refresh_rotation_and_bad_password(db_client: DatabaseHarness) -> None:
    bad = await db_client.client.post(
        "/api/v1/auth/login",
        json={"email": "owner@retailopsbd.com", "password": "incorrect"},
    )
    assert bad.status_code == 401
    auth = await login(db_client.client)
    first_cookie = db_client.client.cookies["retailops_refresh"]
    refreshed = await db_client.client.post("/api/v1/auth/refresh")
    assert refreshed.status_code == 200
    assert refreshed.json()["access_token"] != auth["access_token"]
    assert db_client.client.cookies["retailops_refresh"] != first_cookie


async def test_catalog_inventory_sale_and_idempotency(db_client: DatabaseHarness) -> None:
    auth = await login(db_client.client)
    headers = {"Authorization": f"Bearer {auth['access_token']}"}
    product = await db_client.client.post(
        "/api/v1/products",
        headers=headers,
        json={
            "name": "Test Panjabi",
            "sku": "PAN",
            "variants": [
                {
                    "name": "Blue / M",
                    "sku": "PAN-BL-M",
                    "barcode": "991100",
                    "price": "1500.00",
                    "cost": "800.00",
                    "reorder_level": 2,
                }
            ],
        },
    )
    assert product.status_code == 201
    variant_id = product.json()["variants"][0]["id"]
    adjusted = await db_client.client.post(
        "/api/v1/inventory/adjustments",
        headers=headers,
        json={
            "variant_id": variant_id,
            "quantity_delta": 10,
            "reason": "OPENING_STOCK",
            "note": "Verified count",
        },
    )
    assert adjusted.json()["available_quantity"] == 10
    payload = {
        "items": [{"variant_id": variant_id, "quantity": 2}],
        "payment_method": "CASH",
        "amount_received": "3100.00",
        "client_transaction_id": "34634f47-f2d8-4d0e-91dc-d1dfbdd61082",
    }
    first = await db_client.client.post("/api/v1/pos/sales", headers=headers, json=payload)
    second = await db_client.client.post("/api/v1/pos/sales", headers=headers, json=payload)
    assert first.status_code == 201
    assert first.json()["change_due"] == "100.00"
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["idempotent_replay"] is True
    inventory = await db_client.client.get("/api/v1/inventory", headers=headers)
    assert inventory.json()["items"][0]["available_quantity"] == 8


async def test_cashier_cannot_create_product(db_client: DatabaseHarness) -> None:
    auth = await login(db_client.client, "cashier@retailopsbd.com")
    response = await db_client.client.post(
        "/api/v1/products",
        headers={"Authorization": f"Bearer {auth['access_token']}"},
        json={
            "name": "Forbidden Product",
            "sku": "NOPE",
            "variants": [{"name": "Default", "sku": "NOPE-1", "price": "10.00"}],
        },
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"
