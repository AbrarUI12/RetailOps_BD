import uuid
from collections import Counter

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.models.entities import Order, OrderStatus, Return, ReturnItem, Sale, User
from app.schemas.operations import ReturnCreate, ReturnItemView, ReturnView
from app.services.audit_service import add_audit
from app.services.inventory_service import InventoryService
from app.services.order_service import OrderService

# Sellable returns go back on the shelf; damaged and missing units are recorded in the
# ledger with no change to sellable stock so every returned unit has an explicit trail.
RETURN_EFFECTS: dict[str, tuple[str, bool]] = {
    "SELLABLE": ("RETURN_SELLABLE", True),
    "DAMAGED": ("RETURN_DAMAGED", False),
    "MISSING": ("RETURN_MISSING", False),
}
# Only parcels that actually left the shop can come back.
RETURNABLE_ORDER_STATUSES = {
    OrderStatus.SHIPPED,
    OrderStatus.DELIVERED,
    OrderStatus.FAILED_DELIVERY,
    OrderStatus.RETURN_REQUESTED,
}
# Status path that closes an order once its goods are back in hand.
CLOSING_PATH: dict[OrderStatus, list[OrderStatus]] = {
    OrderStatus.SHIPPED: [OrderStatus.RETURN_REQUESTED, OrderStatus.RETURNED],
    OrderStatus.DELIVERED: [OrderStatus.RETURN_REQUESTED, OrderStatus.RETURNED],
    OrderStatus.RETURN_REQUESTED: [OrderStatus.RETURNED],
    OrderStatus.FAILED_DELIVERY: [OrderStatus.RETURNED],
}


class ReturnsService:
    def __init__(self, session: AsyncSession, user: User) -> None:
        self.session = session
        self.user = user

    async def list_returns(
        self, *, order_id: uuid.UUID | None = None, sale_id: uuid.UUID | None = None
    ) -> list[ReturnView]:
        query = select(Return).where(Return.organization_id == self.user.organization_id)
        if order_id:
            query = query.where(Return.order_id == order_id)
        if sale_id:
            query = query.where(Return.sale_id == sale_id)
        returns = list(
            await self.session.scalars(query.order_by(Return.created_at.desc()).limit(100))
        )
        return [await self._view(item) for item in returns]

    async def receive(self, command: ReturnCreate) -> ReturnView:
        if bool(command.order_id) == bool(command.sale_id):
            raise AppError(
                "RETURN_REFERENCE_REQUIRED",
                "A return must reference exactly one order or one sale",
                status_code=422,
            )
        order: Order | None = None
        if command.order_id:
            order = await self.session.scalar(
                select(Order)
                .where(
                    Order.id == command.order_id,
                    Order.organization_id == self.user.organization_id,
                )
                .with_for_update()
            )
            if order is None:
                raise AppError("ORDER_NOT_FOUND", "Order was not found", status_code=404)
            if order.status not in RETURNABLE_ORDER_STATUSES:
                raise AppError(
                    "ORDER_NOT_RETURNABLE",
                    f"An order that is {order.status.value.replace('_', ' ').lower()} "
                    "has not left the shop",
                    status_code=409,
                )
            sold = Counter({item.variant_id: item.quantity for item in order.items})
        else:
            sale = await self.session.scalar(
                select(Sale).where(
                    Sale.id == command.sale_id,
                    Sale.organization_id == self.user.organization_id,
                )
            )
            if sale is None:
                raise AppError("SALE_NOT_FOUND", "Sale was not found", status_code=404)
            sold = Counter({item.variant_id: item.quantity for item in sale.items})

        remaining = sold - await self._already_returned(command.order_id, command.sale_id)
        requested: Counter[uuid.UUID] = Counter()
        for line in command.items:
            requested[line.variant_id] += line.quantity
        over = {
            str(variant_id): {"requested": quantity, "returnable": remaining.get(variant_id, 0)}
            for variant_id, quantity in requested.items()
            if quantity > remaining.get(variant_id, 0)
        }
        if over:
            raise AppError(
                "RETURN_EXCEEDS_SOLD",
                "More units are being returned than were sold and not yet returned",
                status_code=422,
                details={"lines": over},
            )

        returned = Return(
            organization_id=self.user.organization_id,
            branch_id=self.user.branch_id,
            order_id=command.order_id,
            sale_id=command.sale_id,
            status="RECEIVED",
            reason=command.reason,
        )
        self.session.add(returned)
        await self.session.flush()
        inventory = InventoryService(self.session, self.user)
        for line in command.items:
            self.session.add(
                ReturnItem(
                    organization_id=self.user.organization_id,
                    return_id=returned.id,
                    **line.model_dump(),
                )
            )
            movement_type, restock = RETURN_EFFECTS[line.disposition]
            await inventory.apply_movement(
                variant_id=line.variant_id,
                quantity_delta=line.quantity if restock else 0,
                movement_type=movement_type,
                note=f"{command.reason} ({line.quantity} {line.disposition.lower()})",
                reference_type="return",
                reference_id=returned.id,
            )
        if order is not None:
            fully_returned = requested == remaining
            in_transit = order.status != OrderStatus.DELIVERED
            if in_transit or fully_returned:
                orders = OrderService(self.session, self.user)
                for status in CLOSING_PATH[order.status]:
                    await orders._apply_transition(
                        order, status, f"Return received: {command.reason}"
                    )
        add_audit(
            self.session,
            self.user,
            "return.received",
            "return",
            returned.id,
            new_data={
                "order_id": command.order_id,
                "sale_id": command.sale_id,
                "items": [line.model_dump() for line in command.items],
            },
        )
        await self.session.commit()
        return await self._view(returned)

    async def _already_returned(
        self, order_id: uuid.UUID | None, sale_id: uuid.UUID | None
    ) -> Counter[uuid.UUID]:
        reference = Return.order_id == order_id if order_id else Return.sale_id == sale_id
        rows = await self.session.execute(
            select(ReturnItem.variant_id, func.sum(ReturnItem.quantity))
            .join(Return, Return.id == ReturnItem.return_id)
            .where(Return.organization_id == self.user.organization_id, reference)
            .group_by(ReturnItem.variant_id)
        )
        return Counter({variant_id: int(total) for variant_id, total in rows.all()})

    async def _view(self, returned: Return) -> ReturnView:
        items = await self.session.scalars(
            select(ReturnItem).where(ReturnItem.return_id == returned.id)
        )
        return ReturnView(
            id=returned.id,
            order_id=returned.order_id,
            sale_id=returned.sale_id,
            status=returned.status,
            reason=returned.reason,
            created_at=returned.created_at,
            items=[ReturnItemView.model_validate(item) for item in items],
        )
