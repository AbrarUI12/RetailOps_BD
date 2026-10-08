import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.api.deps import SessionDep, require_permission
from app.models.entities import User
from app.schemas.inventory import InventoryAdjustment, InventoryView, MovementView
from app.services.inventory_service import InventoryService

router = APIRouter(prefix="/inventory", tags=["inventory"])


@router.get("", response_model=list[InventoryView])
async def list_inventory(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("inventory:read"))],
) -> list[InventoryView]:
    return await InventoryService(session, user).list_inventory()


@router.post("/adjustments", response_model=InventoryView, status_code=status.HTTP_201_CREATED)
async def adjust_inventory(
    command: InventoryAdjustment,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("inventory:adjust"))],
) -> InventoryView:
    return await InventoryService(session, user).adjust(command)


@router.get("/movements", response_model=list[MovementView])
async def inventory_movements(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("inventory:read"))],
    variant_id: uuid.UUID | None = None,
) -> list[MovementView]:
    return await InventoryService(session, user).movements(variant_id)


@router.get("/low-stock", response_model=list[InventoryView])
async def low_stock(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("inventory:read"))],
) -> list[InventoryView]:
    return [
        item
        for item in await InventoryService(session, user).list_inventory()
        if item.stock_status != "IN_STOCK"
    ]
