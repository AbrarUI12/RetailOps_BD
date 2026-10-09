import uuid
from decimal import Decimal

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.models.entities import (
    AuditLog,
    Customer,
    CustomerAddress,
    Order,
    OrderStatus,
    OrderStatusEvent,
    Payment,
    Return,
    Sale,
    User,
)
from app.schemas.customers import (
    CustomerActivityView,
    CustomerAddressCreate,
    CustomerAddressView,
    CustomerMetrics,
    CustomerPaymentView,
    CustomerProfile,
    CustomerPurchaseView,
    CustomerReturnView,
    CustomerUpdate,
)
from app.schemas.operations import CustomerCreate, CustomerView, RiskView
from app.services.audit_service import add_audit
from app.services.cod_risk import RiskFacts, calculate_cod_risk
from app.utils.phone import normalize_bd_phone


class CustomerService:
    def __init__(self, session: AsyncSession, user: User) -> None:
        self.session = session
        self.user = user

    async def list_customers(self, search: str | None = None) -> list[CustomerView]:
        query = select(Customer).where(Customer.organization_id == self.user.organization_id)
        if search:
            normalized = None
            try:
                normalized = normalize_bd_phone(search)
            except AppError:
                pass
            query = query.where(
                or_(
                    Customer.name.ilike(f"%{search}%"),
                    Customer.normalized_phone == normalized,
                )
            )
        customers = await self.session.scalars(
            query.order_by(Customer.created_at.desc()).limit(200)
        )
        return [CustomerView.model_validate(customer) for customer in customers]

    async def create(self, command: CustomerCreate, *, commit: bool = True) -> CustomerView:
        normalized = normalize_bd_phone(command.phone)
        customer = await self.session.scalar(
            select(Customer).where(
                Customer.organization_id == self.user.organization_id,
                Customer.normalized_phone == normalized,
            )
        )
        if customer:
            return CustomerView.model_validate(customer)
        customer = Customer(
            organization_id=self.user.organization_id,
            name=command.name,
            phone=command.phone,
            normalized_phone=normalized,
            phone_verified=command.phone_verified,
            notes=command.notes,
        )
        self.session.add(customer)
        await self.session.flush()
        if command.address:
            self.session.add(
                CustomerAddress(
                    organization_id=self.user.organization_id,
                    customer_id=customer.id,
                    **command.address.model_dump(),
                )
            )
        add_audit(
            self.session,
            self.user,
            "customer.created",
            "customer",
            customer.id,
            new_data={"name": customer.name, "phone": normalized},
        )
        if commit:
            await self.session.commit()
        return CustomerView.model_validate(customer)

    async def get(self, customer_id: uuid.UUID) -> CustomerView:
        customer = await self._customer(customer_id)
        return CustomerView.model_validate(customer)

    async def lookup(self, phone: str) -> CustomerView:
        normalized = normalize_bd_phone(phone)
        customer = await self.session.scalar(
            select(Customer).where(
                Customer.organization_id == self.user.organization_id,
                Customer.normalized_phone == normalized,
            )
        )
        if customer is None:
            raise AppError("CUSTOMER_NOT_FOUND", "Customer was not found", status_code=404)
        return CustomerView.model_validate(customer)

    async def update(self, customer_id: uuid.UUID, command: CustomerUpdate) -> CustomerView:
        customer = await self._customer(customer_id)
        changes = command.model_dump(exclude_unset=True)
        if "phone" in changes:
            changes["normalized_phone"] = normalize_bd_phone(str(changes["phone"]))
            duplicate = await self.session.scalar(
                select(Customer).where(
                    Customer.organization_id == self.user.organization_id,
                    Customer.normalized_phone == changes["normalized_phone"],
                    Customer.id != customer.id,
                )
            )
            if duplicate:
                raise AppError(
                    "CUSTOMER_PHONE_EXISTS",
                    "A customer already uses this phone number",
                    status_code=409,
                )
        old_data = {key: getattr(customer, key) for key in changes}
        for key, value in changes.items():
            setattr(customer, key, value)
        add_audit(
            self.session,
            self.user,
            "customer.updated",
            "customer",
            customer.id,
            old_data=old_data,
            new_data=changes,
        )
        await self.session.commit()
        return CustomerView.model_validate(customer)

    async def add_address(
        self, customer_id: uuid.UUID, command: CustomerAddressCreate
    ) -> CustomerAddressView:
        await self._customer(customer_id)
        address = CustomerAddress(
            organization_id=self.user.organization_id,
            customer_id=customer_id,
            **command.model_dump(),
        )
        self.session.add(address)
        await self.session.flush()
        add_audit(
            self.session,
            self.user,
            "customer.address_added",
            "customer",
            customer_id,
            new_data=command.model_dump(),
        )
        await self.session.commit()
        return CustomerAddressView.model_validate(address)

    async def profile(self, customer_id: uuid.UUID) -> CustomerProfile:
        customer = await self._customer(customer_id)
        organization_id = self.user.organization_id
        addresses = list(
            await self.session.scalars(
                select(CustomerAddress)
                .where(
                    CustomerAddress.organization_id == organization_id,
                    CustomerAddress.customer_id == customer_id,
                )
                .order_by(CustomerAddress.created_at.desc())
            )
        )
        sales = list(
            await self.session.scalars(
                select(Sale)
                .where(Sale.organization_id == organization_id, Sale.customer_id == customer_id)
                .order_by(Sale.created_at.desc())
            )
        )
        orders = list(
            await self.session.scalars(
                select(Order)
                .where(Order.organization_id == organization_id, Order.customer_id == customer_id)
                .order_by(Order.created_at.desc())
            )
        )
        sale_ids = [sale.id for sale in sales]
        order_ids = [order.id for order in orders]
        payment_conditions = []
        return_conditions = []
        if sale_ids:
            payment_conditions.append(Payment.sale_id.in_(sale_ids))
            return_conditions.append(Return.sale_id.in_(sale_ids))
        if order_ids:
            payment_conditions.append(Payment.order_id.in_(order_ids))
            return_conditions.append(Return.order_id.in_(order_ids))
        payments = (
            list(
                await self.session.scalars(
                    select(Payment)
                    .where(Payment.organization_id == organization_id, or_(*payment_conditions))
                    .order_by(Payment.created_at.desc())
                )
            )
            if payment_conditions
            else []
        )
        returns = (
            list(
                await self.session.scalars(
                    select(Return)
                    .where(Return.organization_id == organization_id, or_(*return_conditions))
                    .order_by(Return.created_at.desc())
                )
            )
            if return_conditions
            else []
        )
        audits = list(
            await self.session.scalars(
                select(AuditLog)
                .where(
                    AuditLog.organization_id == organization_id,
                    AuditLog.entity_type == "customer",
                    AuditLog.entity_id == customer_id,
                )
                .order_by(AuditLog.created_at.desc())
                .limit(50)
            )
        )
        shipped_cancellations = (
            list(
                await self.session.scalars(
                    select(OrderStatusEvent).where(
                        OrderStatusEvent.organization_id == organization_id,
                        OrderStatusEvent.order_id.in_(order_ids),
                        OrderStatusEvent.from_status == OrderStatus.SHIPPED.value,
                        OrderStatusEvent.to_status == OrderStatus.CANCELLED.value,
                    )
                )
            )
            if order_ids
            else []
        )

        delivered = sum(order.status == OrderStatus.DELIVERED for order in orders)
        unsuccessful = sum(
            order.status in {OrderStatus.RETURNED, OrderStatus.FAILED_DELIVERY} for order in orders
        )
        outcomes = delivered + unsuccessful
        complete_address = any(
            len(address.address.strip()) >= 10 and bool(address.city.strip())
            for address in addresses
        )
        risk = calculate_cod_risk(
            RiskFacts(
                successful_deliveries=delivered,
                returns=unsuccessful,
                shipped_cancellations=len(shipped_cancellations),
                phone_verified=customer.phone_verified,
                complete_address=complete_address,
                prior_orders=len(orders),
            )
        )
        total_spend = sum((sale.total for sale in sales), Decimal("0")) + sum(
            (order.total for order in orders if order.status == OrderStatus.DELIVERED), Decimal("0")
        )
        purchases = [
            CustomerPurchaseView(
                id=sale.id,
                kind="SALE",
                reference=sale.invoice_number,
                status="COMPLETED",
                source="POS",
                total=sale.total,
                created_at=sale.created_at,
            )
            for sale in sales
        ] + [
            CustomerPurchaseView(
                id=order.id,
                kind="ORDER",
                reference=order.order_number,
                status=order.status.value,
                source=order.source.value,
                total=order.total,
                created_at=order.created_at,
            )
            for order in orders
        ]
        purchases.sort(key=lambda item: item.created_at, reverse=True)
        sale_refs = {sale.id: sale.invoice_number for sale in sales}
        order_refs = {order.id: order.order_number for order in orders}

        def reference_for(sale_id: uuid.UUID | None, order_id: uuid.UUID | None) -> str:
            if sale_id is not None and sale_id in sale_refs:
                return sale_refs[sale_id]
            if order_id is not None and order_id in order_refs:
                return order_refs[order_id]
            return "—"

        activity = [
            CustomerActivityView(
                id=str(audit.id),
                kind=audit.action,
                title=audit.action.replace(".", " ").title(),
                detail=None,
                created_at=audit.created_at,
            )
            for audit in audits
        ] + [
            CustomerActivityView(
                id=f"{purchase.kind.lower()}-{purchase.id}",
                kind=f"{purchase.kind.lower()}.recorded",
                title=f"{purchase.kind.title()} {purchase.reference}",
                detail=f"{purchase.status.replace('_', ' ').title()} · {purchase.total:.2f}",
                created_at=purchase.created_at,
            )
            for purchase in purchases
        ]
        activity.sort(key=lambda item: item.created_at, reverse=True)
        return CustomerProfile(
            customer=CustomerView.model_validate(customer),
            metrics=CustomerMetrics(
                total_spend=total_spend,
                sale_count=len(sales),
                order_count=len(orders),
                successful_deliveries=delivered,
                delivery_outcomes=outcomes,
                delivery_success_rate=round(delivered / outcomes * 100, 1) if outcomes else None,
                cod_risk={
                    "score": risk.score,
                    "level": risk.level,
                    "reasons": risk.reasons,
                    "recommendation": risk.recommendation,
                },
            ),
            addresses=[CustomerAddressView.model_validate(address) for address in addresses],
            purchases=purchases,
            payments=[
                CustomerPaymentView(
                    id=payment.id,
                    reference=reference_for(payment.sale_id, payment.order_id),
                    method=payment.method.value,
                    amount=payment.amount,
                    created_at=payment.created_at,
                )
                for payment in payments
            ],
            returns=[
                CustomerReturnView(
                    id=item.id,
                    reference=reference_for(item.sale_id, item.order_id),
                    status=item.status,
                    reason=item.reason,
                    created_at=item.created_at,
                )
                for item in returns
            ],
            activity=activity,
        )

    async def orders(self, customer_id: uuid.UUID) -> list[CustomerPurchaseView]:
        profile = await self.profile(customer_id)
        return [purchase for purchase in profile.purchases if purchase.kind == "ORDER"]

    async def risk(self, customer_id: uuid.UUID) -> RiskView:
        return (await self.profile(customer_id)).metrics.cod_risk

    async def _customer(self, customer_id: uuid.UUID) -> Customer:
        customer = await self.session.scalar(
            select(Customer).where(
                Customer.id == customer_id,
                Customer.organization_id == self.user.organization_id,
            )
        )
        if customer is None:
            raise AppError("CUSTOMER_NOT_FOUND", "Customer was not found", status_code=404)
        return customer
