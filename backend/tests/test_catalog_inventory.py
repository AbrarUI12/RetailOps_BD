import uuid

from httpx import AsyncClient
from sqlalchemy import select

from app.core.security import hash_password
from app.models.entities import Branch, Organization, Product, Role, User, UserRole
from tests.conftest import DatabaseHarness
from tests.test_api_workflows import login
from tests.test_operations_workflows import owner_headers, stock_of, stocked_variant


async def make_product(
    client: AsyncClient, headers: dict[str, str], sku: str, **extra: object
) -> dict[str, object]:
    response = await client.post(
        "/api/v1/products",
        headers=headers,
        json={
            "name": f"Product {sku}",
            "sku": sku,
            "variants": [
                {"name": "Default", "sku": f"{sku}-1", "barcode": f"BC{sku}", "price": "500.00"}
            ],
            **extra,
        },
    )
    assert response.status_code == 201, response.text
    body: dict[str, object] = response.json()
    return body


async def test_categories_crud_and_in_use_guard(db_client: DatabaseHarness) -> None:
    client = db_client.client
    headers = await owner_headers(client)

    created = await client.post(
        "/api/v1/categories", headers=headers, json={"name": "Women's Wear"}
    )
    duplicate = await client.post(
        "/api/v1/categories", headers=headers, json={"name": "women's wear"}
    )
    category_id = created.json()["id"]
    await make_product(client, headers, "KURTI", category_id=category_id)
    renamed = await client.patch(
        f"/api/v1/categories/{category_id}", headers=headers, json={"name": "Ladies"}
    )
    blocked = await client.delete(f"/api/v1/categories/{category_id}", headers=headers)
    listed = await client.get("/api/v1/categories", headers=headers)

    assert created.status_code == 201
    assert created.json()["slug"] == "women-s-wear"
    assert duplicate.status_code == 409
    assert renamed.json()["name"] == "Ladies"
    assert blocked.json()["error"]["code"] == "CATEGORY_IN_USE"
    assert listed.json() == [
        {"id": category_id, "name": "Ladies", "slug": "ladies", "product_count": 1}
    ]


async def test_duplicate_sku_and_barcode_have_distinct_errors(db_client: DatabaseHarness) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    await make_product(client, headers, "TEE")

    same_product_sku = await client.post(
        "/api/v1/products",
        headers=headers,
        json={
            "name": "Again",
            "sku": "tee",
            "variants": [{"name": "X", "sku": "OTHER", "price": "1"}],
        },
    )
    same_variant_sku = await client.post(
        "/api/v1/products",
        headers=headers,
        json={
            "name": "Again",
            "sku": "NEW",
            "variants": [{"name": "X", "sku": "tee-1", "price": "1"}],
        },
    )
    same_barcode = await client.post(
        "/api/v1/products",
        headers=headers,
        json={
            "name": "Again",
            "sku": "NEW2",
            "variants": [{"name": "X", "sku": "NEW2-1", "barcode": "BCTEE", "price": "1"}],
        },
    )

    assert same_product_sku.json()["error"]["code"] == "DUPLICATE_SKU"
    assert same_variant_sku.json()["error"]["code"] == "DUPLICATE_SKU"
    assert same_barcode.json()["error"]["code"] == "DUPLICATE_BARCODE"
    assert same_barcode.json()["error"]["details"] == {"field": "barcode"}


async def test_variants_can_be_added_edited_and_deactivated(db_client: DatabaseHarness) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    product = await make_product(client, headers, "SHIRT")

    added = await client.post(
        f"/api/v1/products/{product['id']}/variants",
        headers=headers,
        json={
            "name": "Blue / L",
            "sku": "shirt-bl-l",
            "price": "650.00",
            "attributes": {"Color": "Blue", "Size": "L"},
        },
    )
    variant = next(item for item in added.json()["variants"] if item["sku"] == "SHIRT-BL-L")
    edited = await client.patch(
        f"/api/v1/variants/{variant['id']}",
        headers=headers,
        json={"price": "700.00", "barcode": "8901"},
    )
    clash = await client.patch(
        f"/api/v1/variants/{variant['id']}", headers=headers, json={"barcode": "BCSHIRT"}
    )
    deactivated = await client.delete(f"/api/v1/products/{product['id']}", headers=headers)

    assert added.status_code == 201
    assert len(added.json()["variants"]) == 2
    edited_variant = next(item for item in edited.json()["variants"] if item["id"] == variant["id"])
    assert edited_variant["price"] == "700.00"
    assert edited_variant["barcode"] == "8901"
    assert clash.json()["error"]["code"] == "DUPLICATE_BARCODE"
    assert deactivated.json()["is_active"] is False
    assert all(not item["is_active"] for item in deactivated.json()["variants"])
    lookup = await client.get("/api/v1/products/barcode/8901", headers=headers)
    assert lookup.status_code == 404


async def test_product_filters_and_stock(db_client: DatabaseHarness) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    low_id = await stocked_variant(client, headers, 2)
    await stocked_variant(client, headers, 50)
    await make_product(client, headers, "ZERO")

    by_barcode = await client.get("/api/v1/products", headers=headers, params={"search": "BCZERO"})
    low = await client.get("/api/v1/products", headers=headers, params={"stock": "low"})
    out = await client.get("/api/v1/products", headers=headers, params={"stock": "out"})

    assert [item["sku"] for item in by_barcode.json()["items"]] == ["ZERO"]
    assert [item["variants"][0]["id"] for item in low.json()["items"]] == [low_id]
    assert low.json()["items"][0]["variants"][0]["available_quantity"] == 2
    assert [item["sku"] for item in out.json()["items"]] == ["ZERO"]


async def test_counted_adjustment_records_the_difference(db_client: DatabaseHarness) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    variant_id = await stocked_variant(client, headers, 12)

    counted = await client.post(
        "/api/v1/inventory/adjustments",
        headers=headers,
        json={
            "variant_id": variant_id,
            "counted_quantity": 20,
            "reason": "COUNT_CORRECTION",
            "note": "Closing shift count",
        },
    )
    unchanged = await client.post(
        "/api/v1/inventory/adjustments",
        headers=headers,
        json={
            "variant_id": variant_id,
            "counted_quantity": 20,
            "reason": "COUNT_CORRECTION",
            "note": "Recount",
        },
    )
    damaged = await client.post(
        "/api/v1/inventory/adjustments",
        headers=headers,
        json={
            "variant_id": variant_id,
            "quantity_delta": -3,
            "reason": "DAMAGED",
            "note": "Water damage",
        },
    )
    too_many = await client.post(
        "/api/v1/inventory/adjustments",
        headers=headers,
        json={
            "variant_id": variant_id,
            "quantity_delta": -50,
            "reason": "LOST_OR_STOLEN",
            "note": "Missing",
        },
    )
    both = await client.post(
        "/api/v1/inventory/adjustments",
        headers=headers,
        json={
            "variant_id": variant_id,
            "quantity_delta": 1,
            "counted_quantity": 3,
            "reason": "OTHER",
            "note": "x" * 3,
        },
    )

    assert counted.json()["physical_quantity"] == 20
    assert unchanged.json()["error"]["code"] == "NO_STOCK_CHANGE"
    assert damaged.json()["physical_quantity"] == 17
    assert too_many.status_code == 409
    assert both.status_code == 422
    detail = (await client.get(f"/api/v1/inventory/{variant_id}", headers=headers)).json()
    latest, previous = detail["movements"][0], detail["movements"][1]
    assert latest["movement_type"] == "DAMAGED"
    assert latest["created_by_name"] == "Owner User"
    assert previous["quantity_delta"] == 8
    assert previous["note"] == "Physical count correction: Closing shift count"


async def test_inventory_list_is_paged_and_filterable(db_client: DatabaseHarness) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    await stocked_variant(client, headers, 1)
    await stocked_variant(client, headers, 30)

    low = await client.get("/api/v1/inventory", headers=headers, params={"status": "low"})
    first_page = await client.get("/api/v1/inventory", headers=headers, params={"page_size": 1})

    assert low.json()["total"] == 1
    assert low.json()["items"][0]["stock_status"] == "LOW_STOCK"
    assert first_page.json()["total"] == 2
    assert len(first_page.json()["items"]) == 1


async def test_another_tenant_cannot_see_or_edit_products(db_client: DatabaseHarness) -> None:
    client = db_client.client
    owner = await owner_headers(client)
    product = await make_product(client, owner, "PRIVATE")
    async with db_client.sessions() as session:
        other = Organization(name="Other Shop", slug="other-shop")
        session.add(other)
        await session.flush()
        branch = Branch(organization_id=other.id, name="Other", code="OTH")
        role = Role(organization_id=other.id, name=UserRole.OWNER)
        session.add_all([branch, role])
        await session.flush()
        session.add(
            User(
                organization_id=other.id,
                branch_id=branch.id,
                role_id=role.id,
                email="intruder@othershop.com",
                full_name="Other Owner",
                password_hash=hash_password("RetailOps123!"),
            )
        )
        await session.commit()
    intruder = await login(client, "intruder@othershop.com")
    headers = {"Authorization": f"Bearer {intruder['access_token']}"}

    listed = await client.get("/api/v1/products", headers=headers)
    fetched = await client.get(f"/api/v1/products/{product['id']}", headers=headers)
    edited = await client.patch(
        f"/api/v1/products/{product['id']}", headers=headers, json={"name": "Hijacked"}
    )
    variant_edit = await client.patch(
        f"/api/v1/variants/{product['variants'][0]['id']}",  # type: ignore[index]
        headers=headers,
        json={"price": "1.00"},
    )

    assert listed.json()["total"] == 0
    assert fetched.status_code == 404
    assert edited.status_code == 404
    assert variant_edit.status_code == 404
    async with db_client.sessions() as session:
        name = await session.scalar(
            select(Product.name).where(Product.id == uuid.UUID(str(product["id"])))
        )
    assert name == "Product PRIVATE"
    assert (await stock_of(client, owner, str(product["variants"][0]["id"])))["physical"] == 0  # type: ignore[index]
