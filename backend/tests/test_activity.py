import uuid

from sqlalchemy import select

from app.models.entities import AuditLog, Notification, Organization, User
from tests.conftest import DatabaseHarness
from tests.test_api_workflows import login
from tests.test_operations_workflows import owner_headers


async def test_audit_trail_is_filterable_paginated_and_tenant_scoped(
    db_client: DatabaseHarness,
) -> None:
    headers = await owner_headers(db_client.client)
    async with db_client.sessions() as session:
        owner = await session.scalar(select(User).where(User.email == "owner@retailopsbd.com"))
        assert owner is not None
        foreign = Organization(name="Foreign Audit", slug="foreign-audit")
        session.add(foreign)
        await session.flush()
        session.add_all(
            [
                AuditLog(
                    organization_id=owner.organization_id,
                    user_id=owner.id,
                    action="inventory.adjusted",
                    entity_type="product_variant",
                    entity_id=uuid.uuid4(),
                    old_data={"physical_quantity": 3},
                    new_data={"physical_quantity": 5},
                    request_id="audit-request",
                    ip_address="127.0.0.1",
                    user_agent="pytest",
                ),
                AuditLog(
                    organization_id=foreign.id,
                    user_id=None,
                    action="foreign.secret",
                    entity_type="organization",
                    entity_id=foreign.id,
                ),
            ]
        )
        await session.commit()

    response = await db_client.client.get(
        "/api/v1/audit",
        headers=headers,
        params={"action": "inventory.adjusted", "page_size": 1},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["page"] == 1
    assert body["page_size"] == 1
    assert body["total"] == 1
    assert body["items"][0] == {
        "id": body["items"][0]["id"],
        "action": "inventory.adjusted",
        "entity_type": "product_variant",
        "entity_id": body["items"][0]["entity_id"],
        "user_id": body["items"][0]["user_id"],
        "actor_name": "Owner User",
        "actor_email": "owner@retailopsbd.com",
        "old_data": {"physical_quantity": 3},
        "new_data": {"physical_quantity": 5},
        "request_id": "audit-request",
        "ip_address": "127.0.0.1",
        "user_agent": "pytest",
        "created_at": body["items"][0]["created_at"],
    }
    searched = await db_client.client.get("/api/v1/audit", headers=headers, params={"q": "Owner"})
    assert searched.status_code == 200
    assert searched.json()["total"] >= 1
    all_rows = await db_client.client.get(
        "/api/v1/audit", headers=headers, params={"page_size": 100}
    )
    assert all(row["action"] != "foreign.secret" for row in all_rows.json()["items"])

    inverted = await db_client.client.get(
        "/api/v1/audit",
        headers=headers,
        params={"start": "2026-10-10", "end": "2026-10-09"},
    )
    assert inverted.status_code == 422
    assert inverted.json()["error"]["code"] == "INVALID_DATE_RANGE"


async def test_cashier_cannot_read_audit_log(db_client: DatabaseHarness) -> None:
    cashier = await login(db_client.client, "cashier@retailopsbd.com")
    response = await db_client.client.get(
        "/api/v1/audit",
        headers={"Authorization": f"Bearer {cashier['access_token']}"},
    )
    assert response.status_code == 403


async def test_notification_read_state_is_per_user_and_target_safe(
    db_client: DatabaseHarness,
) -> None:
    owner = await owner_headers(db_client.client)
    cashier_auth = await login(db_client.client, "cashier@retailopsbd.com")
    cashier = {"Authorization": f"Bearer {cashier_auth['access_token']}"}
    async with db_client.sessions() as session:
        users = {
            user.email: user
            for user in await session.scalars(
                select(User).where(
                    User.email.in_(["owner@retailopsbd.com", "cashier@retailopsbd.com"])
                )
            )
        }
        shared = Notification(
            organization_id=users["owner@retailopsbd.com"].organization_id,
            kind="LOW_STOCK",
            title="Shared stock alert",
            message="Two units left",
            entity_type="product_variant",
            entity_id=uuid.uuid4(),
        )
        owner_only = Notification(
            organization_id=users["owner@retailopsbd.com"].organization_id,
            user_id=users["owner@retailopsbd.com"].id,
            kind="SECURITY",
            title="Owner only",
            message="Review this session",
        )
        cashier_only = Notification(
            organization_id=users["owner@retailopsbd.com"].organization_id,
            user_id=users["cashier@retailopsbd.com"].id,
            kind="REGISTER",
            title="Cashier only",
            message="Register message",
        )
        session.add_all([shared, owner_only, cashier_only])
        await session.commit()
        shared_id, owner_only_id = shared.id, owner_only.id

    owner_list = await db_client.client.get("/api/v1/notifications", headers=owner)
    assert {item["title"] for item in owner_list.json()} == {
        "Shared stock alert",
        "Owner only",
    }
    marked = await db_client.client.post(f"/api/v1/notifications/{shared_id}/read", headers=owner)
    assert marked.status_code == 200
    assert marked.json()["read_at"] is not None
    assert (
        await db_client.client.get("/api/v1/notifications?unread_only=true", headers=owner)
    ).json()[0]["title"] == "Owner only"
    assert (await db_client.client.get("/api/v1/workspace/counts", headers=owner)).json()[
        "unread_notifications"
    ] == 1

    cashier_unread = await db_client.client.get(
        "/api/v1/notifications?unread_only=true", headers=cashier
    )
    assert {item["title"] for item in cashier_unread.json()} == {
        "Shared stock alert",
        "Cashier only",
    }
    assert (await db_client.client.get("/api/v1/workspace/counts", headers=cashier)).json()[
        "unread_notifications"
    ] == 2
    forbidden_target = await db_client.client.post(
        f"/api/v1/notifications/{owner_only_id}/read", headers=cashier
    )
    assert forbidden_target.status_code == 404

    await db_client.client.post("/api/v1/notifications/read-all", headers=owner)
    assert (
        await db_client.client.get("/api/v1/notifications?unread_only=true", headers=owner)
    ).json() == []
    remaining = await db_client.client.get(
        "/api/v1/notifications?unread_only=true", headers=cashier
    )
    assert len(remaining.json()) == 2
