import uuid
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import SessionDep, ensure_permission, require_permission
from app.models.entities import OrderSource, OrderStatus, User
from app.schemas.operations import (
    CourierUpdateInput,
    OrderCreate,
    OrderDetailView,
    OrderView,
    ShipmentView,
    TransitionInput,
)
from app.services.order_service import OrderService

router = APIRouter(prefix="/orders", tags=["orders"])

TRANSITION_PERMISSIONS = {
    OrderStatus.CONFIRMED: "order:confirm",
    OrderStatus.CANCELLED: "order:cancel",
    OrderStatus.SHIPPED: "shipment:create",
}


@router.get("", response_model=list[OrderView])
async def list_orders(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("order:read"))],
    search: Annotated[str | None, Query(max_length=100)] = None,
    order_status: Annotated[OrderStatus | None, Query(alias="status")] = None,
    source: OrderSource | None = None,
    risk: Literal["LOW", "MEDIUM", "HIGH", "VERY_HIGH"] | None = None,
    created_from: date | None = None,
    created_to: date | None = None,
) -> list[OrderView]:
    return await OrderService(session, user).list_orders(
        search=search,
        status=order_status,
        source=source,
        risk=risk,
        created_from=created_from,
        created_to=created_to,
    )


@router.post("", response_model=OrderView, status_code=status.HTTP_201_CREATED)
async def create_order(
    command: OrderCreate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("order:write"))],
) -> OrderView:
    return await OrderService(session, user).create(command)


@router.get("/{order_id}", response_model=OrderDetailView)
async def get_order(
    order_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("order:read"))],
) -> OrderDetailView:
    return await OrderService(session, user).detail(order_id)


@router.post("/{order_id}/transition", response_model=OrderView)
async def transition_order(
    order_id: uuid.UUID,
    command: TransitionInput,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("order:write"))],
) -> OrderView:
    # The generic endpoint must not bypass the dedicated confirm/cancel/ship permissions.
    ensure_permission(user, TRANSITION_PERMISSIONS.get(command.status, "order:write"))
    return await OrderService(session, user).transition(order_id, command.status, command.note)


@router.post("/{order_id}/confirm", response_model=OrderView)
async def confirm_order(
    order_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("order:confirm"))],
) -> OrderView:
    return await OrderService(session, user).transition(order_id, OrderStatus.CONFIRMED)


@router.post("/{order_id}/cancel", response_model=OrderView)
async def cancel_order(
    order_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("order:cancel"))],
) -> OrderView:
    return await OrderService(session, user).transition(order_id, OrderStatus.CANCELLED)


@router.post("/{order_id}/pack", response_model=OrderView)
async def pack_order(
    order_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("order:write"))],
) -> OrderView:
    return await OrderService(session, user).transition(order_id, OrderStatus.PACKING)


@router.post("/{order_id}/shipment", response_model=ShipmentView)
async def create_shipment(
    order_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("shipment:create"))],
) -> ShipmentView:
    return await OrderService(session, user).create_shipment(order_id)


@router.get("/{order_id}/shipment", response_model=ShipmentView)
async def get_shipment(
    order_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("order:read"))],
) -> ShipmentView:
    return await OrderService(session, user).get_shipment(order_id)


@router.post("/{order_id}/shipment/events", response_model=ShipmentView)
async def record_courier_update(
    order_id: uuid.UUID,
    command: CourierUpdateInput,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("shipment:create"))],
) -> ShipmentView:
    """Normalized courier status update, as a provider webhook or tracking poll would deliver."""
    return await OrderService(session, user).record_courier_update(
        order_id, command.status, command.description
    )
