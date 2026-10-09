from tests.conftest import DatabaseHarness
from tests.test_catalog_inventory import make_product
from tests.test_operations_workflows import owner_headers, stocked_variant


async def test_catalog_version_tracks_catalog_edits_not_stock(db_client: DatabaseHarness) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    variant_id = await stocked_variant(client, headers, 5)
    first = (await client.get("/api/v1/sync/catalog-version", headers=headers)).json()

    await client.post(
        "/api/v1/inventory/adjustments",
        headers=headers,
        json={"variant_id": variant_id, "quantity_delta": 3, "reason": "FOUND", "note": "Shelf"},
    )
    after_stock = (await client.get("/api/v1/sync/catalog-version", headers=headers)).json()
    await client.patch(f"/api/v1/variants/{variant_id}", headers=headers, json={"price": "999.00"})
    after_price = (await client.get("/api/v1/sync/catalog-version", headers=headers)).json()

    assert first["variant_count"] == 1
    assert after_stock["version"] == first["version"]
    assert after_price["version"] != first["version"]


async def test_catalog_snapshot_lists_sellable_variants_with_stock(
    db_client: DatabaseHarness,
) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    category = (
        await client.post("/api/v1/categories", headers=headers, json={"name": "Apparel"})
    ).json()
    sellable = await make_product(client, headers, "SELL", category_id=category["id"])
    retired = await make_product(client, headers, "OLD")
    await client.delete(f"/api/v1/products/{retired['id']}", headers=headers)
    variant_id = sellable["variants"][0]["id"]  # type: ignore[index]
    await client.post(
        "/api/v1/inventory/adjustments",
        headers=headers,
        json={
            "variant_id": variant_id,
            "quantity_delta": 4,
            "reason": "OPENING_STOCK",
            "note": "Count",
        },
    )

    snapshot = (await client.get("/api/v1/sync/catalog", headers=headers)).json()
    stock = (await client.get("/api/v1/sync/stock", headers=headers)).json()
    version = (await client.get("/api/v1/sync/catalog-version", headers=headers)).json()

    assert snapshot["version"] == version["version"]
    assert [item["sku"] for item in snapshot["items"]] == ["SELL-1"]
    item = snapshot["items"][0]
    assert item["barcode"] == "BCSELL"
    assert item["category_name"] == "Apparel"
    assert item["available_quantity"] == 4
    assert snapshot["categories"] == [{"id": category["id"], "name": "Apparel"}]
    assert stock["available"] == {variant_id: 4}


async def test_catalog_requires_authentication(db_client: DatabaseHarness) -> None:
    response = await db_client.client.get("/api/v1/sync/catalog-version")

    assert response.status_code == 401
