import uuid
from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import SessionDep, require_permission
from app.models.entities import User
from app.schemas.operations import ShipmentView
from app.services.order_service import OrderService

router = APIRouter(prefix="/shipments", tags=["shipments"])


@router.get("/{shipment_id}", response_model=ShipmentView)
async def get_shipment(
    shipment_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("order:read"))],
) -> ShipmentView:
    return await OrderService(session, user).get_shipment_by_id(shipment_id)


@router.post("/{shipment_id}/refresh", response_model=ShipmentView)
async def refresh_shipment(
    shipment_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("shipment:create"))],
) -> ShipmentView:
    return await OrderService(session, user).refresh_shipment(shipment_id)


@router.post("/{shipment_id}/cancel", response_model=ShipmentView)
async def cancel_shipment(
    shipment_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("shipment:create"))],
) -> ShipmentView:
    return await OrderService(session, user).cancel_shipment(shipment_id)
