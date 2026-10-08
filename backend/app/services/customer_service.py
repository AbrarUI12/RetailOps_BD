import uuid

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.models.entities import Customer, CustomerAddress, User
from app.schemas.operations import CustomerCreate, CustomerView
from app.services.audit_service import add_audit
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

    async def create(self, command: CustomerCreate) -> CustomerView:
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
        await self.session.commit()
        return CustomerView.model_validate(customer)

    async def get(self, customer_id: uuid.UUID) -> CustomerView:
        customer = await self.session.scalar(
            select(Customer).where(
                Customer.id == customer_id,
                Customer.organization_id == self.user.organization_id,
            )
        )
        if customer is None:
            raise AppError("CUSTOMER_NOT_FOUND", "Customer was not found", status_code=404)
        return CustomerView.model_validate(customer)
