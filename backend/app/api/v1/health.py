from typing import Annotated

from fastapi import APIRouter, Depends, Response, status

from app.api.deps import get_health_service
from app.core.config import Settings, get_settings
from app.schemas.health import LiveHealth, ReadyHealth
from app.services.health_service import HealthService

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/live", response_model=LiveHealth)
async def live(settings: Annotated[Settings, Depends(get_settings)]) -> LiveHealth:
    return LiveHealth(service=settings.app_name, version=settings.app_version)


@router.get(
    "/ready",
    response_model=ReadyHealth,
    responses={status.HTTP_503_SERVICE_UNAVAILABLE: {"model": ReadyHealth}},
)
async def ready(
    response: Response,
    service: Annotated[HealthService, Depends(get_health_service)],
) -> ReadyHealth:
    result = await service.readiness()
    if result.status == "not_ready":
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return result
