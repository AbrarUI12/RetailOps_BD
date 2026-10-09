import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.models.entities import (
    Customer,
    InventoryReservation,
    Order,
    OrderItem,
    OrderStatus,
    OrderStatusEvent,
    Product,
    ProductVariant,
    Shipment,
    ShipmentEvent,
    User,
)
from app.schemas.operations import (
    OrderCreate,
    OrderItemView,
    OrderView,
    RiskView,
    ShipmentEventView,
    ShipmentView,
)
from app.services.audit_service import add_audit
from app.services.cod_risk import (
    RiskFacts,
    RiskResult,
    calculate_cod_risk,
    recommendation_for,
)
from app.services.couriers import ORDER_STATUS_FOR, CourierStatus, get_provider
from app.services.customer_service import CustomerService
from app.services.inventory_service import InventoryService

LEGAL_TRANSITIONS: dict[OrderStatus, set[OrderStatus]] = {
    OrderStatus.DRAFT: {OrderStatus.PENDING_CONFIRMATION, OrderStatus.CANCELLED},
    OrderStatus.PENDING_CONFIRMATION: {OrderStatus.CONFIRMED, OrderStatus.CANCELLED},
    OrderStatus.CONFIRMED: {OrderStatus.PACKING, OrderStatus.CANCELLED},
    OrderStatus.PACKING: {OrderStatus.READY_FOR_SHIPMENT, OrderStatus.CANCELLED},
    OrderStatus.READY_FOR_SHIPMENT: {OrderStatus.SHIPPED, OrderStatus.CANCELLED},
    OrderStatus.SHIPPED: {
        OrderStatus.DELIVERED,
        OrderStatus.FAILED_DELIVERY,
        OrderStatus.RETURN_REQUESTED,
    },
    OrderStatus.DELIVERED: {OrderStatus.RETURN_REQUESTED},
    OrderStatus.RETURN_REQUESTED: {OrderStatus.RETURNED},
    OrderStatus.FAILED_DELIVERY: {OrderStatus.RETURNED},
    OrderStatus.CANCELLED: set(),
    OrderStatus.RETURNED: set(),
}


class OrderService:
    def __init__(self, session: AsyncSession, user: User) -> None:
        self.session = session
        self.user = user

    async def list_orders(self) -> list[OrderView]:
        orders = await self.session.scalars(
            select(Order)
            .where(Order.organization_id == self.user.organization_id)
            .order_by(Order.created_at.desc())
            .limit(200)
        )
        return [self._view(order) for order in orders]

    async def create(self, command: OrderCreate) -> OrderView:
        variant_ids = [line.variant_id for line in command.items]
        rows = (
            await self.session.execute(
                select(ProductVariant, Product)
                .join(Product, Product.id == ProductVariant.product_id)
                .where(
                    ProductVariant.organization_id == self.user.organization_id,
                    ProductVariant.id.in_(variant_ids),
                    ProductVariant.is_active.is_(True),
                )
            )
        ).all()
        catalog = {variant.id: (variant, product) for variant, product in rows}
        if len(catalog) != len(set(variant_ids)):
            raise AppError("INVALID_ORDER_ITEM", "An order item is unavailable", status_code=422)
        subtotal = sum(
            (catalog[line.variant_id][0].price * line.quantity for line in command.items),
            Decimal("0"),
        )
        if command.discount > subtotal + command.delivery_fee:
            raise AppError("INVALID_DISCOUNT", "Discount exceeds order value", status_code=422)
        customer_id = command.customer_id
        if customer_id is None and command.customer:
            created_customer = await CustomerService(self.session, self.user).create(
                command.customer, commit=False
            )
            customer_id = created_customer.id
        if customer_id is None:  # Kept defensive for non-HTTP callers; the schema also enforces it.
            raise AppError("CUSTOMER_REQUIRED", "Select or create a customer", status_code=422)
        customer = await self.session.scalar(
            select(Customer).where(
                Customer.id == customer_id,
                Customer.organization_id == self.user.organization_id,
            )
        )
        if customer is None:
            raise AppError("CUSTOMER_NOT_FOUND", "Customer was not found", status_code=404)
        risk = await self._risk(customer, command.delivery_address)
        now = datetime.now(UTC)
        order = Order(
            organization_id=self.user.organization_id,
            branch_id=self.user.branch_id,
            customer_id=customer.id,
            order_number=f"ORD-{now:%Y%m%d}-{uuid.uuid4().hex[:6].upper()}",
            source=command.source,
            status=OrderStatus.PENDING_CONFIRMATION,
            delivery_address=command.delivery_address,
            area=command.area,
            subtotal=subtotal,
            delivery_fee=command.delivery_fee,
            discount=command.discount,
            total=subtotal + command.delivery_fee - command.discount,
            cod_risk_score=risk.score,
            cod_risk_level=risk.level,
            risk_reasons=risk.reasons,
            items=[],
        )
        self.session.add(order)
        await self.session.flush()
        for line in command.items:
            variant, product = catalog[line.variant_id]
            order.items.append(
                OrderItem(
                    organization_id=self.user.organization_id,
                    variant_id=variant.id,
                    product_name=product.name,
                    quantity=line.quantity,
                    unit_price=variant.price,
                    line_total=variant.price * line.quantity,
                )
            )
        self.session.add(
            OrderStatusEvent(
                organization_id=self.user.organization_id,
                order_id=order.id,
                from_status=None,
                to_status=order.status.value,
                changed_by=self.user.id,
                note="Order created",
            )
        )
        add_audit(self.session, self.user, "order.created", "order", order.id)
        await self.session.commit()
        created = await self._get_model(order.id)
        return self._view(created)

    async def transition(
        self, order_id: uuid.UUID, target: OrderStatus, note: str | None = None
    ) -> OrderView:
        order = await self._get_model(order_id, lock=True)
        await self._apply_transition(order, target, note)
        await self.session.commit()
        return self._view(order)

    async def _apply_transition(
        self, order: Order, target: OrderStatus, note: str | None = None
    ) -> None:
        if target not in LEGAL_TRANSITIONS[order.status]:
            raise AppError(
                "ILLEGAL_ORDER_TRANSITION",
                f"Cannot move {order.status.value} to {target.value}",
                status_code=409,
            )
        previous = order.status
        if target == OrderStatus.CONFIRMED:
            await self._reserve(order)
        if target == OrderStatus.CANCELLED:
            await self._release(order)
        if target == OrderStatus.SHIPPED:
            await self._consume(order)
        order.status = target
        self.session.add(
            OrderStatusEvent(
                organization_id=self.user.organization_id,
                order_id=order.id,
                from_status=previous.value,
                to_status=target.value,
                changed_by=self.user.id,
                note=note,
            )
        )
        add_audit(
            self.session,
            self.user,
            "order.status_changed",
            "order",
            order.id,
            old_data={"status": previous.value},
            new_data={"status": target.value},
        )

    async def create_shipment(self, order_id: uuid.UUID) -> ShipmentView:
        order = await self._get_model(order_id, lock=True)
        existing = await self.session.scalar(select(Shipment).where(Shipment.order_id == order.id))
        if existing:
            return await self._shipment_view(existing, order)
        if order.status != OrderStatus.READY_FOR_SHIPMENT:
            raise AppError("ORDER_NOT_READY", "Order must be ready for shipment", status_code=409)
        provider = get_provider()
        booking = await provider.create_shipment(order)
        shipment = Shipment(
            organization_id=self.user.organization_id,
            order_id=order.id,
            provider=provider.name,
            tracking_code=booking.tracking_code,
            status=booking.status.value,
        )
        self.session.add(shipment)
        await self.session.flush()
        self._add_shipment_event(shipment, booking.status, f"Booked with {provider.name}")
        add_audit(self.session, self.user, "shipment.created", "shipment", shipment.id)
        await self.session.commit()
        return await self._shipment_view(shipment, order)

    async def get_shipment(self, order_id: uuid.UUID) -> ShipmentView:
        order = await self._get_model(order_id)
        shipment = await self._shipment_for(order)
        return await self._shipment_view(shipment, order)

    async def record_courier_update(
        self, order_id: uuid.UUID, status: CourierStatus, description: str | None = None
    ) -> ShipmentView:
        """Apply a normalized courier status (webhook or tracking poll) to shipment and order."""
        order = await self._get_model(order_id, lock=True)
        shipment = await self._shipment_for(order)
        if shipment.status == status.value:
            return await self._shipment_view(shipment, order)
        shipment.status = status.value
        self._add_shipment_event(shipment, status, description or status.value.replace("_", " "))
        target = ORDER_STATUS_FOR.get(status)
        if target and target in LEGAL_TRANSITIONS[order.status]:
            await self._apply_transition(order, target, f"Courier reported {status.value}")
        await self.session.commit()
        return await self._shipment_view(shipment, order)

    async def _shipment_for(self, order: Order) -> Shipment:
        shipment = await self.session.scalar(
            select(Shipment).where(
                Shipment.order_id == order.id,
                Shipment.organization_id == self.user.organization_id,
            )
        )
        if shipment is None:
            raise AppError("SHIPMENT_NOT_FOUND", "Order has no shipment yet", status_code=404)
        return shipment

    def _add_shipment_event(
        self, shipment: Shipment, status: CourierStatus, description: str
    ) -> None:
        self.session.add(
            ShipmentEvent(
                organization_id=self.user.organization_id,
                shipment_id=shipment.id,
                status=status.value,
                description=description,
            )
        )

    async def _shipment_view(self, shipment: Shipment, order: Order) -> ShipmentView:
        events = await self.session.scalars(
            select(ShipmentEvent)
            .where(ShipmentEvent.shipment_id == shipment.id)
            .order_by(ShipmentEvent.occurred_at)
        )
        view = ShipmentView.model_validate(shipment)
        view.order_status = order.status
        view.events = [ShipmentEventView.model_validate(event) for event in events]
        return view

    async def _get_model(self, order_id: uuid.UUID, lock: bool = False) -> Order:
        query = select(Order).where(
            Order.id == order_id,
            Order.organization_id == self.user.organization_id,
        )
        if lock:
            query = query.with_for_update()
        order = await self.session.scalar(query)
        if order is None:
            raise AppError("ORDER_NOT_FOUND", "Order was not found", status_code=404)
        return order

    async def _reserve(self, order: Order) -> None:
        inventory = InventoryService(self.session, self.user)
        for item in order.items:
            try:
                await inventory.reserve(
                    variant_id=item.variant_id, branch_id=order.branch_id, quantity=item.quantity
                )
            except AppError as exc:
                raise AppError(
                    "INSUFFICIENT_STOCK",
                    f"Not enough stock for {item.product_name}",
                    status_code=409,
                    details=exc.details,
                ) from exc
            self.session.add(
                InventoryReservation(
                    organization_id=self.user.organization_id,
                    branch_id=order.branch_id,
                    order_id=order.id,
                    variant_id=item.variant_id,
                    quantity=item.quantity,
                )
            )

    async def _active_reservations(self, order: Order) -> list[InventoryReservation]:
        return list(
            await self.session.scalars(
                select(InventoryReservation).where(
                    InventoryReservation.order_id == order.id,
                    InventoryReservation.active.is_(True),
                )
            )
        )

    async def _release(self, order: Order) -> None:
        inventory = InventoryService(self.session, self.user)
        for reservation in await self._active_reservations(order):
            await inventory.release(
                variant_id=reservation.variant_id,
                branch_id=reservation.branch_id,
                quantity=reservation.quantity,
            )
            reservation.active = False

    async def _consume(self, order: Order) -> None:
        """Turn active reservations into physical stock deductions when the parcel leaves."""
        inventory = InventoryService(self.session, self.user)
        for reservation in await self._active_reservations(order):
            await inventory.release(
                variant_id=reservation.variant_id,
                branch_id=reservation.branch_id,
                quantity=reservation.quantity,
            )
            await inventory.apply_movement(
                variant_id=reservation.variant_id,
                quantity_delta=-reservation.quantity,
                movement_type="ORDER_FULFILLMENT",
                note=f"Order {order.order_number} shipped",
                reference_type="order",
                reference_id=order.id,
                allow_negative=True,
            )
            reservation.active = False

    async def _risk(self, customer: Customer, address: str) -> RiskResult:
        delivered = await self.session.scalar(
            select(func.count(Order.id)).where(
                Order.customer_id == customer.id,
                Order.status == OrderStatus.DELIVERED,
            )
        )
        returned = await self.session.scalar(
            select(func.count(Order.id)).where(
                Order.customer_id == customer.id,
                Order.status.in_([OrderStatus.RETURNED, OrderStatus.FAILED_DELIVERY]),
            )
        )
        prior = await self.session.scalar(
            select(func.count(Order.id)).where(Order.customer_id == customer.id)
        )
        # A booked parcel the courier later cancelled: the closest thing to "cancelled after
        # shipment" this state machine allows.
        cancelled_shipments = await self.session.scalar(
            select(func.count(Shipment.id))
            .join(Order, Order.id == Shipment.order_id)
            .where(Order.customer_id == customer.id, Shipment.status == "CANCELLED")
        )
        recent = await self.session.scalar(
            select(func.count(Order.id)).where(
                Order.customer_id == customer.id,
                Order.created_at >= datetime.now(UTC) - timedelta(minutes=30),
            )
        )
        return calculate_cod_risk(
            RiskFacts(
                successful_deliveries=delivered or 0,
                returns=returned or 0,
                phone_verified=customer.phone_verified,
                duplicate_recent_order=bool(recent),
                complete_address=len(address.strip()) >= 12,
                prior_orders=prior or 0,
                shipped_cancellations=cancelled_shipments or 0,
            )
        )

    @staticmethod
    def _view(order: Order) -> OrderView:
        risk = RiskView(
            score=order.cod_risk_score,
            level=order.cod_risk_level,
            reasons=order.risk_reasons,
            recommendation=recommendation_for(order.cod_risk_level),
        )
        return OrderView(
            id=order.id,
            order_number=order.order_number,
            customer_id=order.customer_id,
            source=order.source,
            status=order.status,
            delivery_address=order.delivery_address,
            area=order.area,
            subtotal=order.subtotal,
            delivery_fee=order.delivery_fee,
            discount=order.discount,
            total=order.total,
            risk=risk,
            items=[
                OrderItemView(
                    variant_id=item.variant_id,
                    product_name=item.product_name,
                    quantity=item.quantity,
                    unit_price=item.unit_price,
                    line_total=item.line_total,
                )
                for item in order.items
            ],
            created_at=order.created_at,
        )
