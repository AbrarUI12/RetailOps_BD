import uuid

import pytest
from fastapi import status
from httpx import AsyncClient

from app.core.exceptions import AppError
from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from app.services.cod_risk import RiskFacts, calculate_cod_risk
from app.utils.phone import normalize_bd_phone
from tests.conftest import DatabaseHarness


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("01712-345678", "+8801712345678"),
        ("+880 1712 345 678", "+8801712345678"),
        ("8801712345678", "+8801712345678"),
    ],
)
def test_bangladesh_phone_formats_are_canonical(raw: str, expected: str) -> None:
    assert normalize_bd_phone(raw) == expected


def test_invalid_bangladesh_phone_is_rejected() -> None:
    with pytest.raises(AppError) as error:
        normalize_bd_phone("012345")
    assert error.value.code == "INVALID_PHONE"


def test_cod_risk_rules_are_explainable_and_clamped() -> None:
    result = calculate_cod_risk(
        RiskFacts(
            successful_deliveries=0,
            returns=3,
            shipped_cancellations=1,
            phone_verified=False,
            duplicate_recent_order=True,
            complete_address=False,
            prior_orders=4,
        )
    )
    assert result.score == 90
    assert result.level == "VERY_HIGH"
    assert "Phone is unverified" in result.reasons
    assert result.recommendation == "Require advance payment or manager approval"


def test_loyal_customer_receives_low_risk_score() -> None:
    result = calculate_cod_risk(
        RiskFacts(successful_deliveries=8, phone_verified=True, prior_orders=8)
    )
    assert result.score == 0
    assert result.level == "LOW"


def test_password_hash_and_access_token_round_trip() -> None:
    password_hash = hash_password("RetailOps123!")
    assert verify_password("RetailOps123!", password_hash)
    assert not verify_password("wrong", password_hash)
    user_id = uuid.uuid4()
    organization_id = uuid.uuid4()
    token = create_access_token(
        user_id=user_id, organization_id=organization_id, session_id=uuid.uuid4()
    )
    payload = decode_access_token(token)
    assert payload["sub"] == str(user_id)
    assert payload["organization_id"] == str(organization_id)


async def test_security_headers_are_present(client: AsyncClient) -> None:
    response = await client.get("/health/live")
    assert response.status_code == status.HTTP_200_OK
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["x-request-id"]


async def test_unknown_host_is_rejected_except_for_health_probes(client: AsyncClient) -> None:
    rejected = await client.get("/api/v1/sync/catalog-version", headers={"host": "evil.example"})
    probe = await client.get("/health/live", headers={"host": "10.0.0.7:10000"})

    assert rejected.status_code == status.HTTP_400_BAD_REQUEST
    assert probe.status_code == status.HTTP_200_OK


async def test_login_is_rate_limited_per_client(db_client: DatabaseHarness) -> None:
    attempt = {"email": "owner@retailopsbd.com", "password": "incorrect"}
    for _ in range(10):
        response = await db_client.client.post("/api/v1/auth/login", json=attempt)
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    blocked = await db_client.client.post("/api/v1/auth/login", json=attempt)

    assert blocked.status_code == status.HTTP_429_TOO_MANY_REQUESTS
    assert blocked.headers["retry-after"] == "60"
