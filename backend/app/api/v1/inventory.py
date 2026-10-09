import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import SessionDep, require_permission
from app.models.entities import User
from app.schemas.inventory import (
    InventoryAdjustment,
    InventoryDetail,
    InventoryPage,
    InventoryView,
    MovementView,
)
from app.services.inventory_service import InventoryService

router = APIRouter(prefix="/inventory", tags=["inventory"])
Reader = Annotated[User, Depends(require_permission("inventory:read"))]


@router.get("", response_model=InventoryPage)
async def list_inventory(
    session: SessionDep,
    user: Reader,
    search: str | None = None,
    status: Literal["in_stock", "low", "out", "reorder"] | None = None,
    category_id: uuid.UUID | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
) -> InventoryPage:
    return await InventoryService(session, user).list_inventory(
        search=search, status=status, category_id=category_id, page=page, page_size=page_size
    )


@router.post("/adjustments", response_model=InventoryView, status_code=status.HTTP_201_CREATED)
async def adjust_inventory(
    command: InventoryAdjustment,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("inventory:adjust"))],
) -> InventoryView:
    return await InventoryService(session, user).adjust(command)


@router.get("/movements", response_model=list[MovementView])
async def inventory_movements(
    session: SessionDep, user: Reader, variant_id: uuid.UUID | None = None
) -> list[MovementView]:
    return await InventoryService(session, user).movements(variant_id)


@router.get("/low-stock", response_model=InventoryPage)
async def low_stock(session: SessionDep, user: Reader) -> InventoryPage:
    """Variants at or below their reorder level, out-of-stock included."""
    return await InventoryService(session, user).list_inventory(status="reorder", page_size=200)


@router.get("/{variant_id}", response_model=InventoryDetail)
async def inventory_detail(
    variant_id: uuid.UUID, session: SessionDep, user: Reader
) -> InventoryDetail:
    return await InventoryService(session, user).detail(variant_id)
