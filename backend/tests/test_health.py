from collections.abc import Awaitable, Callable

from fastapi import status
from httpx import AsyncClient

from app.api.deps import get_health_service
from app.main import app
from app.services.health_service import HealthService


async def healthy() -> None:
    return None


async def unavailable() -> None:
    raise ConnectionError("dependency unavailable")


def override_health(
    database: Callable[[], Awaitable[None]], redis: Callable[[], Awaitable[None]]
) -> None:
    app.dependency_overrides[get_health_service] = lambda: HealthService(database, redis)


async def test_liveness_does_not_require_dependencies(client: AsyncClient) -> None:
    response = await client.get("/health/live")

    assert response.status_code == status.HTTP_200_OK
    assert response.json() == {
        "status": "ok",
        "service": "RetailOps BD API",
        "version": "0.1.0",
    }


async def test_readiness_reports_all_dependencies(client: AsyncClient) -> None:
    override_health(healthy, healthy)

    response = await client.get("/health/ready")

    assert response.status_code == status.HTTP_200_OK
    assert response.json() == {
        "status": "ready",
        "checks": {"database": "ok", "redis": "ok"},
    }
    app.dependency_overrides.clear()


async def test_readiness_fails_when_database_is_unavailable(client: AsyncClient) -> None:
    override_health(unavailable, healthy)

    response = await client.get("/health/ready")

    assert response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    assert response.json()["checks"] == {"database": "unavailable", "redis": "ok"}
    app.dependency_overrides.clear()


async def test_readiness_fails_when_redis_is_unavailable(client: AsyncClient) -> None:
    override_health(healthy, unavailable)

    response = await client.get("/health/ready")

    assert response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    assert response.json()["checks"] == {"database": "ok", "redis": "unavailable"}
    app.dependency_overrides.clear()
