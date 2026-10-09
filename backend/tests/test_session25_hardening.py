import uuid
from types import SimpleNamespace

import pytest
from fastapi import status
from httpx import AsyncClient
from pydantic import ValidationError
from sqlalchemy import select

import app.core.middleware as middleware_module
import app.services.auth_service as auth_service_module
from app.core.config import Settings
from app.core.security import create_access_token, decode_access_token
from app.models.entities import User
from app.schemas.operations import CustomerCreate, PurchaseCreate, ReturnCreate, SupplierCreate
from app.schemas.sales import CreateSaleRequest, RefundSaleRequest
from app.services.audit_service import sanitize_audit_data
from tests.conftest import DatabaseHarness
from tests.test_api_workflows import login


@pytest.mark.parametrize(
    "origin",
    [
        "*",
        "javascript://retailops.example",
        "https://user:secret@retailops.example",
        "https://retailops.example/path",
        "https://retailops.example?next=evil",
        "https://retailops.example:invalid",
    ],
)
def test_cors_rejects_values_that_are_not_origins(origin: str) -> None:
    with pytest.raises(ValidationError):
        Settings(cors_origins=[origin])


def test_cors_normalizes_trailing_slashes_and_duplicates() -> None:
    settings = Settings(cors_origins=["https://retailops.example/", "https://retailops.example"])

    assert settings.cors_origins == ["https://retailops.example"]


def test_frontend_host_rejects_paths_and_credentials() -> None:
    with pytest.raises(ValidationError):
        Settings(frontend_host="retailops.example/path")
    with pytest.raises(ValidationError):
        Settings(frontend_host="user:secret@retailops.example")


def test_production_rejects_an_unrestricted_host_allowlist() -> None:
    with pytest.raises(ValidationError, match="APP_ALLOWED_HOSTS"):
        Settings.model_validate(
            {
                "APP_ENV": "production",
                "secret_key": "x" * 48,
                "secure_cookies": True,
                "frontend_host": "retailops.example",
                "allowed_hosts": ["*"],
            }
        )


async def test_unknown_login_still_performs_password_verification(
    db_client: DatabaseHarness, monkeypatch: pytest.MonkeyPatch
) -> None:
    checked_hashes: list[str] = []

    def record_verification(_: str, password_hash: str) -> bool:
        checked_hashes.append(password_hash)
        return False

    monkeypatch.setattr(auth_service_module, "verify_password", record_verification)
    response = await db_client.client.post(
        "/api/v1/auth/login",
        json={"email": "missing@retailopsbd.com", "password": "NotThePassword1"},
    )

    assert response.status_code == status.HTTP_401_UNAUTHORIZED
    assert checked_hashes == [auth_service_module.DUMMY_PASSWORD_HASH]


async def test_access_token_session_must_belong_to_its_user(
    db_client: DatabaseHarness,
) -> None:
    cashier_login = await login(db_client.client, "cashier@retailopsbd.com")
    cashier_payload = decode_access_token(cashier_login["access_token"])
    async with db_client.sessions() as session:
        owner = await session.scalar(select(User).where(User.email == "owner@retailopsbd.com"))
        assert owner is not None
        forged = create_access_token(
            user_id=owner.id,
            organization_id=owner.organization_id,
            session_id=uuid.UUID(cashier_payload["session_id"]),
        )

    response = await db_client.client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {forged}"}
    )

    assert response.status_code == status.HTTP_401_UNAUTHORIZED


async def test_auth_responses_are_not_cached_and_request_ids_are_sanitized(
    db_client: DatabaseHarness,
) -> None:
    response = await db_client.client.post(
        "/api/v1/auth/login",
        headers={"X-Request-ID": "unsafe request id"},
        json={"email": "missing@example.com", "password": "NotThePassword1"},
    )

    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-request-id"] != "unsafe request id"
    assert len(response.headers["x-request-id"]) == 32


async def test_production_responses_include_hsts(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        middleware_module, "get_settings", lambda: SimpleNamespace(environment="production")
    )

    response = await client.get("/health/live")

    assert response.headers["strict-transport-security"] == ("max-age=31536000; includeSubDomains")


async def test_auth_rate_limits_are_separate_per_operation(
    db_client: DatabaseHarness, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(auth_service_module, "verify_password", lambda *_: False)
    for _ in range(10):
        await db_client.client.post(
            "/api/v1/auth/login",
            json={"email": "missing@example.com", "password": "NotThePassword1"},
        )

    response = await db_client.client.post(
        "/api/v1/auth/forgot-password", json={"email": "missing@example.com"}
    )

    assert response.status_code == status.HTTP_202_ACCEPTED


def test_audit_snapshot_recursively_redacts_credentials() -> None:
    value = {
        "name": "Safe",
        "password": "do-not-store",
        "nested": [{"refresh_token": "also-secret", "access_token": "jwt", "count": 2}],
    }

    assert sanitize_audit_data(value) == {
        "name": "Safe",
        "password": "[REDACTED]",
        "nested": [{"refresh_token": "[REDACTED]", "access_token": "[REDACTED]", "count": 2}],
    }


@pytest.mark.parametrize(
    ("model", "payload"),
    [
        (CreateSaleRequest, {"items": []}),
        (RefundSaleRequest, {"reason": "reason", "items": []}),
        (ReturnCreate, {"reason": "reason", "items": []}),
        (PurchaseCreate, {"reference": "PO-1", "items": []}),
    ],
)
def test_business_write_models_reject_more_than_100_lines(
    model: type, payload: dict[str, object]
) -> None:
    line = {"variant_id": str(uuid.uuid4()), "quantity": 1}
    if model is CreateSaleRequest:
        payload.update(payment_method="CASH", amount_received="1")
    elif model is RefundSaleRequest:
        line["disposition"] = "SELLABLE"
    elif model is ReturnCreate:
        payload["sale_id"] = str(uuid.uuid4())
        line["disposition"] = "SELLABLE"
    else:
        payload["supplier_id"] = str(uuid.uuid4())
        line["unit_cost"] = "1.00"
    payload["items"] = [line] * 101

    with pytest.raises(ValidationError, match="at most 100"):
        model.model_validate(payload)


def test_contact_fields_are_bounded_and_supplier_email_is_validated() -> None:
    with pytest.raises(ValidationError):
        CustomerCreate(name="Customer", phone="1" * 25)
    with pytest.raises(ValidationError):
        SupplierCreate(name="Supplier", email="not-an-email")
