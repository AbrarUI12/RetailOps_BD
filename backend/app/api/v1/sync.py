import uuid
from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import SessionDep, require_permission
from app.models.entities import User
from app.schemas.catalog import CatalogSnapshot, CatalogVersion, StockSnapshot
from app.schemas.operations import SyncResult, SyncSaleInput
from app.services.catalog_service import CatalogService
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


@router.get("/status/{client_transaction_id}", response_model=SyncResult)
async def sync_status(
    client_transaction_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("sale:create"))],
) -> SyncResult:
    return await SyncService(session, user).status(client_transaction_id)


@router.get("/catalog-version", response_model=CatalogVersion)
async def catalog_version(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("product:read"))],
) -> CatalogVersion:
    """Cheap check the POS makes before deciding to download the catalog again."""
    return await CatalogService(session, user).version()


@router.get("/catalog", response_model=CatalogSnapshot)
async def catalog(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("product:read"))],
) -> CatalogSnapshot:
    """Every sellable variant, flattened for local search on the device."""
    return await CatalogService(session, user).snapshot()


@router.get("/stock", response_model=StockSnapshot)
async def stock(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("product:read"))],
) -> StockSnapshot:
    return await CatalogService(session, user).stock()
