import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.api.deps import SessionDep, require_permission
from app.models.entities import User
from app.schemas.operations import (
    PurchaseCreate,
    PurchaseView,
    ReturnCreate,
    SupplierCreate,
    SupplierView,
)
from app.services.procurement_service import ProcurementService

router = APIRouter(tags=["purchases and returns"])


@router.get("/suppliers", response_model=list[SupplierView])
async def list_suppliers(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("purchase:write"))],
) -> list[SupplierView]:
    return await ProcurementService(session, user).suppliers()


@router.post("/suppliers", response_model=SupplierView, status_code=status.HTTP_201_CREATED)
async def create_supplier(
    command: SupplierCreate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("purchase:write"))],
) -> SupplierView:
    return await ProcurementService(session, user).create_supplier(command)


@router.get("/purchases", response_model=list[PurchaseView])
async def list_purchases(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("purchase:write"))],
) -> list[PurchaseView]:
    return await ProcurementService(session, user).purchases()


@router.post("/purchases", response_model=PurchaseView, status_code=status.HTTP_201_CREATED)
async def create_purchase(
    command: PurchaseCreate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("purchase:write"))],
) -> PurchaseView:
    return await ProcurementService(session, user).create_purchase(command)


@router.post("/purchases/{purchase_id}/receive", response_model=PurchaseView)
async def receive_purchase(
    purchase_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("purchase:write"))],
) -> PurchaseView:
    return await ProcurementService(session, user).receive(purchase_id)


@router.post("/returns", status_code=status.HTTP_201_CREATED)
async def receive_return(
    command: ReturnCreate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("return:create"))],
) -> dict[str, object]:
    return await ProcurementService(session, user).receive_return(command)
