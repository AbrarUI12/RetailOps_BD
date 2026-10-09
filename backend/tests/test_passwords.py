from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, update

from app.core.security import decode_access_token, password_problems
from app.models.entities import AuditLog, PasswordResetToken, RefreshSession
from app.services import auth_service
from tests.conftest import DatabaseHarness
from tests.test_api_workflows import login
from tests.test_operations_workflows import owner_headers

NEW_PASSWORD = "Fresh-start-2026"


@pytest.fixture
def reset_links(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    links: list[str] = []
    monkeypatch.setattr(
        auth_service, "deliver_password_reset", lambda _user, link: links.append(link)
    )
    return links


def test_password_policy() -> None:
    assert password_problems("short1") == ["Use at least 10 characters"]
    assert "Mix letters and numbers" in password_problems("onlyletterslong")
    assert password_problems("owner2026xyz", email="owner@retailopsbd.com")
    assert password_problems(NEW_PASSWORD, email="owner@retailopsbd.com") == []


async def test_access_token_carries_role_and_permissions(db_client: DatabaseHarness) -> None:
    auth = await login(db_client.client, "cashier@retailopsbd.com")

    claims = decode_access_token(str(auth["access_token"]))

    assert claims["role"] == "CASHIER"
    assert "sale:create" in claims["permissions"]
    assert "report:read" not in claims["permissions"]


async def test_forgot_and_reset_password_is_one_time(
    db_client: DatabaseHarness, reset_links: list[str]
) -> None:
    client = db_client.client
    old_session = await owner_headers(client)

    unknown = await client.post(
        "/api/v1/auth/forgot-password", json={"email": "nobody@example.com"}
    )
    known = await client.post(
        "/api/v1/auth/forgot-password", json={"email": "owner@retailopsbd.com"}
    )
    token = reset_links[0].split("token=")[1]
    weak = await client.post(
        "/api/v1/auth/reset-password", json={"token": token, "new_password": "weak"}
    )
    reset = await client.post(
        "/api/v1/auth/reset-password", json={"token": token, "new_password": NEW_PASSWORD}
    )
    reused = await client.post(
        "/api/v1/auth/reset-password", json={"token": token, "new_password": NEW_PASSWORD}
    )

    assert unknown.status_code == known.status_code == 202
    assert unknown.json() == known.json()
    assert len(reset_links) == 1
    assert reset_links[0].startswith("http://localhost:5173/reset-password?token=")
    assert weak.json()["error"]["code"] == "WEAK_PASSWORD"
    assert reset.status_code == 204
    assert reused.json()["error"]["code"] == "INVALID_RESET_TOKEN"
    assert (await client.get("/api/v1/auth/me", headers=old_session)).status_code == 401
    new_login = await client.post(
        "/api/v1/auth/login", json={"email": "owner@retailopsbd.com", "password": NEW_PASSWORD}
    )
    assert new_login.status_code == 200
    async with db_client.sessions() as session:
        actions = set(await session.scalars(select(AuditLog.action)))
        stored = await session.scalar(select(PasswordResetToken.token_hash))
    assert {"auth.password_reset_requested", "auth.password_reset"} <= actions
    assert stored != token


async def test_expired_reset_token_is_rejected(
    db_client: DatabaseHarness, reset_links: list[str]
) -> None:
    await db_client.client.post(
        "/api/v1/auth/forgot-password", json={"email": "owner@retailopsbd.com"}
    )
    async with db_client.sessions() as session:
        await session.execute(
            update(PasswordResetToken).values(expires_at=datetime.now(UTC) - timedelta(minutes=1))
        )
        await session.commit()

    response = await db_client.client.post(
        "/api/v1/auth/reset-password",
        json={"token": reset_links[0].split("token=")[1], "new_password": NEW_PASSWORD},
    )

    assert response.json()["error"]["code"] == "INVALID_RESET_TOKEN"


async def test_change_password_keeps_this_device_only(db_client: DatabaseHarness) -> None:
    client = db_client.client
    other_device = await owner_headers(client)
    this_device = await owner_headers(client)

    wrong = await client.post(
        "/api/v1/auth/change-password",
        headers=this_device,
        json={"current_password": "not-it-at-all", "new_password": NEW_PASSWORD},
    )
    changed = await client.post(
        "/api/v1/auth/change-password",
        headers=this_device,
        json={"current_password": "RetailOps123!", "new_password": NEW_PASSWORD},
    )

    assert wrong.status_code == 400
    assert changed.status_code == 204
    assert (await client.get("/api/v1/auth/me", headers=this_device)).status_code == 200
    assert (await client.get("/api/v1/auth/me", headers=other_device)).status_code == 401


async def test_sessions_record_device_ip(db_client: DatabaseHarness) -> None:
    await login(db_client.client)

    async with db_client.sessions() as session:
        ip = await session.scalar(select(RefreshSession.ip_address))

    assert ip == "127.0.0.1"
