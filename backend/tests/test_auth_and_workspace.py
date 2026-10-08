from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update

from app.models.entities import AuditLog, Notification, Organization, RefreshSession
from tests.conftest import DatabaseHarness
from tests.test_api_workflows import login
from tests.test_operations_workflows import create_order, owner_headers, stocked_variant

REFRESH_COOKIE = "retailops_refresh"


async def test_me_includes_store_and_branch(db_client: DatabaseHarness) -> None:
    headers = await owner_headers(db_client.client)

    me = await db_client.client.get("/api/v1/auth/me", headers=headers)

    assert me.status_code == 200
    assert me.json()["organization_name"] == "Test Retail"
    assert me.json()["branch_name"] == "Test Branch"
    assert "report:read" in me.json()["permissions"]


async def test_logout_revokes_already_issued_access_tokens(db_client: DatabaseHarness) -> None:
    headers = await owner_headers(db_client.client)
    assert (await db_client.client.get("/api/v1/auth/me", headers=headers)).status_code == 200

    await db_client.client.post("/api/v1/auth/logout")

    assert (await db_client.client.get("/api/v1/auth/me", headers=headers)).status_code == 401


async def test_rotation_keeps_the_new_access_token_valid(db_client: DatabaseHarness) -> None:
    await login(db_client.client)

    refreshed = await db_client.client.post("/api/v1/auth/refresh")
    headers = {"Authorization": f"Bearer {refreshed.json()['access_token']}"}

    assert (await db_client.client.get("/api/v1/auth/me", headers=headers)).status_code == 200


async def test_reused_refresh_token_revokes_the_family(db_client: DatabaseHarness) -> None:
    client = db_client.client
    await login(client)
    stolen = client.cookies[REFRESH_COOKIE]
    refreshed = await client.post("/api/v1/auth/refresh")
    current = {"Authorization": f"Bearer {refreshed.json()['access_token']}"}
    # Pretend the rotation happened a while ago, outside the multi-tab grace window.
    async with db_client.sessions() as session:
        await session.execute(
            update(RefreshSession)
            .where(RefreshSession.revoked_at.is_not(None))
            .values(revoked_at=datetime.now(UTC) - timedelta(minutes=5))
        )
        await session.commit()

    client.cookies.set(REFRESH_COOKIE, stolen, path="/api/v1/auth")
    reuse = await client.post("/api/v1/auth/refresh")

    assert reuse.status_code == 401
    assert (await client.get("/api/v1/auth/me", headers=current)).status_code == 401
    async with db_client.sessions() as session:
        actions = set(await session.scalars(select(AuditLog.action)))
    assert "auth.refresh_reuse_detected" in actions


async def test_concurrent_refresh_within_grace_does_not_revoke(db_client: DatabaseHarness) -> None:
    client = db_client.client
    await login(client)
    first_cookie = client.cookies[REFRESH_COOKIE]
    refreshed = await client.post("/api/v1/auth/refresh")
    current = {"Authorization": f"Bearer {refreshed.json()['access_token']}"}

    client.cookies.set(REFRESH_COOKIE, first_cookie, path="/api/v1/auth")
    late_tab = await client.post("/api/v1/auth/refresh")

    assert late_tab.status_code == 401
    assert (await client.get("/api/v1/auth/me", headers=current)).status_code == 200


async def test_logout_everywhere_ends_all_sessions(db_client: DatabaseHarness) -> None:
    first = await owner_headers(db_client.client)
    second = await owner_headers(db_client.client)

    response = await db_client.client.post("/api/v1/auth/logout-all", headers=second)

    assert response.status_code == 204
    assert (await db_client.client.get("/api/v1/auth/me", headers=first)).status_code == 401


async def test_logins_are_audited(db_client: DatabaseHarness) -> None:
    await db_client.client.post(
        "/api/v1/auth/login", json={"email": "owner@retailopsbd.com", "password": "wrong-password"}
    )
    await login(db_client.client)

    async with db_client.sessions() as session:
        actions = list(await session.scalars(select(AuditLog.action).order_by(AuditLog.created_at)))
    assert actions[:2] == ["auth.login_failed", "auth.login"]


async def test_counts_follow_role_permissions(db_client: DatabaseHarness) -> None:
    owner = await owner_headers(db_client.client)
    variant_id = await stocked_variant(db_client.client, owner, 2)
    await create_order(db_client.client, owner, variant_id)
    async with db_client.sessions() as session:
        organization_id = await session.scalar(select(Organization.id))
        session.add(
            Notification(
                organization_id=organization_id, kind="LOW_STOCK", title="Low", message="x"
            )
        )
        await session.commit()

    owner_counts = (await db_client.client.get("/api/v1/workspace/counts", headers=owner)).json()
    cashier = await login(db_client.client, "cashier@retailopsbd.com")
    cashier_counts = (
        await db_client.client.get(
            "/api/v1/workspace/counts",
            headers={"Authorization": f"Bearer {cashier['access_token']}"},
        )
    ).json()

    assert owner_counts == {
        "orders_to_action": 1,
        "low_stock": 1,
        "open_conflicts": 0,
        "unread_notifications": 1,
    }
    assert cashier_counts["orders_to_action"] is None
    read_all = await db_client.client.post("/api/v1/notifications/read-all", headers=owner)
    assert read_all.status_code == 204
    after = (await db_client.client.get("/api/v1/workspace/counts", headers=owner)).json()
    assert after["unread_notifications"] == 0


async def test_search_finds_products_customers_and_orders(db_client: DatabaseHarness) -> None:
    owner = await owner_headers(db_client.client)
    variant_id = await stocked_variant(db_client.client, owner, 5)
    order_id = await create_order(db_client.client, owner, variant_id)

    by_phone = await db_client.client.get(
        "/api/v1/search", headers=owner, params={"q": "01712345678"}
    )
    by_product = await db_client.client.get("/api/v1/search", headers=owner, params={"q": "saree"})

    kinds = {hit["kind"]: hit for hit in by_phone.json()}
    assert kinds["customer"]["title"] == "Nusrat Jahan"
    assert kinds["order"]["to"] == f"/orders?focus={order_id}"
    assert by_product.json()[0]["kind"] == "product"


async def test_cashier_search_excludes_orders(db_client: DatabaseHarness) -> None:
    owner = await owner_headers(db_client.client)
    variant_id = await stocked_variant(db_client.client, owner, 5)
    await create_order(db_client.client, owner, variant_id)
    cashier = await login(db_client.client, "cashier@retailopsbd.com")

    hits = await db_client.client.get(
        "/api/v1/search",
        headers={"Authorization": f"Bearer {cashier['access_token']}"},
        params={"q": "ORD-"},
    )

    assert all(hit["kind"] != "order" for hit in hits.json())
