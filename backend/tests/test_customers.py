from app.core.security import hash_password
from app.models.entities import Branch, Organization, Role, User, UserRole
from tests.conftest import DatabaseHarness
from tests.test_api_workflows import login
from tests.test_operations_workflows import owner_headers, stocked_variant


async def test_customer_phone_lookup_normalizes_equivalent_formats(
    db_client: DatabaseHarness,
) -> None:
    headers = await owner_headers(db_client.client)
    created = await db_client.client.post(
        "/api/v1/customers",
        headers=headers,
        json={"name": "Rahim Ahmed", "phone": "01712-345678"},
    )
    assert created.status_code == 201

    for phone in ("01712345678", "+880 1712 345678", "8801712345678"):
        response = await db_client.client.get(
            "/api/v1/customers/lookup", headers=headers, params={"phone": phone}
        )
        assert response.status_code == 200
        assert response.json()["id"] == created.json()["id"]
        assert response.json()["normalized_phone"] == "+8801712345678"


async def test_customer_profile_combines_addresses_sales_and_orders(
    db_client: DatabaseHarness,
) -> None:
    client = db_client.client
    headers = await owner_headers(client)
    customer = await client.post(
        "/api/v1/customers",
        headers=headers,
        json={
            "name": "Nusrat Jahan",
            "phone": "+8801812345678",
            "address": {
                "label": "Home",
                "address": "House 12, Road 4, Dhanmondi",
                "area": "Dhanmondi",
                "city": "Dhaka",
            },
        },
    )
    customer_id = customer.json()["id"]
    address = await client.post(
        f"/api/v1/customers/{customer_id}/addresses",
        headers=headers,
        json={
            "label": "Office",
            "address": "Level 4, Motijheel Commercial Area",
            "area": "Motijheel",
            "city": "Dhaka",
        },
    )
    assert address.status_code == 201
    variant_id = await stocked_variant(client, headers, 5)
    sale = await client.post(
        "/api/v1/pos/sales",
        headers=headers,
        json={
            "customer_id": customer_id,
            "items": [{"variant_id": variant_id, "quantity": 1}],
            "payment_method": "CASH",
            "amount_received": "1000.00",
        },
    )
    assert sale.status_code == 201
    order = await client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "customer_id": customer_id,
            "delivery_address": "House 12, Road 4, Dhanmondi",
            "source": "FACEBOOK",
            "items": [{"variant_id": variant_id, "quantity": 1}],
        },
    )
    assert order.status_code == 201

    profile = await client.get(f"/api/v1/customers/{customer_id}/profile", headers=headers)

    assert profile.status_code == 200
    payload = profile.json()
    assert payload["customer"]["normalized_phone"] == "+8801812345678"
    assert payload["metrics"]["total_spend"] == "1000.00"
    assert payload["metrics"]["sale_count"] == 1
    assert payload["metrics"]["order_count"] == 1
    assert {item["label"] for item in payload["addresses"]} == {"Home", "Office"}
    assert [item["kind"] for item in payload["purchases"]] == ["ORDER", "SALE"]
    assert payload["payments"][0]["method"] == "CASH"
    risk = await client.get(f"/api/v1/customers/{customer_id}/risk", headers=headers)
    assert risk.status_code == 200
    assert risk.json() == payload["metrics"]["cod_risk"]


async def test_customer_profile_is_tenant_scoped(db_client: DatabaseHarness) -> None:
    headers = await owner_headers(db_client.client)
    created = await db_client.client.post(
        "/api/v1/customers",
        headers=headers,
        json={"name": "Tenant Customer", "phone": "01912345678"},
    )
    async with db_client.sessions() as session:
        other = Organization(name="Other Shop", slug="customer-other-shop")
        session.add(other)
        await session.flush()
        branch = Branch(organization_id=other.id, name="Other", code="COTH")
        role = Role(organization_id=other.id, name=UserRole.OWNER)
        session.add_all([branch, role])
        await session.flush()
        session.add(
            User(
                organization_id=other.id,
                branch_id=branch.id,
                role_id=role.id,
                email="customer-intruder@othershop.com",
                full_name="Other Owner",
                password_hash=hash_password("RetailOps123!"),
            )
        )
        await session.commit()
    intruder = await login(db_client.client, "customer-intruder@othershop.com")
    intruder_headers = {"Authorization": f"Bearer {intruder['access_token']}"}

    profile = await db_client.client.get(
        f"/api/v1/customers/{created.json()['id']}/profile", headers=intruder_headers
    )
    lookup = await db_client.client.get(
        "/api/v1/customers/lookup",
        headers=intruder_headers,
        params={"phone": "01912345678"},
    )

    assert profile.status_code == 404
    assert lookup.status_code == 404
