from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import SessionDep, require_permission
from app.models.entities import User
from app.schemas.operations import SyncResult, SyncSaleInput
from app.services.sync_service import SyncService

router = APIRouter(prefix="/sync", tags=["offline synchronization"])


@router.post("/sales", response_model=SyncResult)
async def sync_sale(
    command: SyncSaleInput,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("sale:create"))],
) -> SyncResult:
    return await SyncService(session, user).sync_sale(command)


@router.get("/conflicts", response_model=list[dict[str, object]])
async def sync_conflicts(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("inventory:read"))],
) -> list[dict[str, object]]:
    return await SyncService(session, user).conflicts()


@router.get("/catalog-version")
async def catalog_version() -> dict[str, str]:
    return {"version": "1"}
