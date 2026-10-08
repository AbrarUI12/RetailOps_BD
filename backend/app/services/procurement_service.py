import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.models.entities import (
    Purchase,
    PurchaseItem,
    Supplier,
    User,
)
from app.schemas.operations import (
    PurchaseCreate,
    PurchaseView,
    SupplierCreate,
    SupplierView,
)
from app.services.audit_service import add_audit
from app.services.inventory_service import InventoryService


class ProcurementService:
    def __init__(self, session: AsyncSession, user: User) -> None:
        self.session = session
        self.user = user
        self.inventory = InventoryService(session, user)

    async def suppliers(self) -> list[SupplierView]:
        suppliers = await self.session.scalars(
            select(Supplier)
            .where(Supplier.organization_id == self.user.organization_id)
            .order_by(Supplier.name)
        )
        return [SupplierView.model_validate(supplier) for supplier in suppliers]

    async def create_supplier(self, command: SupplierCreate) -> SupplierView:
        supplier = Supplier(organization_id=self.user.organization_id, **command.model_dump())
        self.session.add(supplier)
        await self.session.commit()
        return SupplierView.model_validate(supplier)

    async def purchases(self) -> list[PurchaseView]:
        purchases = await self.session.scalars(
            select(Purchase)
            .where(Purchase.organization_id == self.user.organization_id)
            .order_by(Purchase.created_at.desc())
        )
        return [self._purchase_view(purchase) for purchase in purchases]

    async def create_purchase(self, command: PurchaseCreate) -> PurchaseView:
        supplier = await self.session.scalar(
            select(Supplier).where(
                Supplier.id == command.supplier_id,
                Supplier.organization_id == self.user.organization_id,
            )
        )
        if supplier is None:
            raise AppError("SUPPLIER_NOT_FOUND", "Supplier was not found", status_code=404)
        total = sum((line.unit_cost * line.quantity for line in command.items), Decimal("0"))
        purchase = Purchase(
            organization_id=self.user.organization_id,
            branch_id=self.user.branch_id,
            supplier_id=supplier.id,
            reference=command.reference,
            status="DRAFT",
            total=total,
        )
        self.session.add(purchase)
        await self.session.flush()
        self.session.add_all(
            [
                PurchaseItem(
                    organization_id=self.user.organization_id,
                    purchase_id=purchase.id,
                    **line.model_dump(),
                )
                for line in command.items
            ]
        )
        await self.session.commit()
        return self._purchase_view(purchase)

    async def receive(self, purchase_id: uuid.UUID) -> PurchaseView:
        purchase = await self.session.scalar(
            select(Purchase)
            .where(
                Purchase.id == purchase_id,
                Purchase.organization_id == self.user.organization_id,
            )
            .with_for_update()
        )
        if purchase is None:
            raise AppError("PURCHASE_NOT_FOUND", "Purchase was not found", status_code=404)
        if purchase.status == "RECEIVED":
            return self._purchase_view(purchase)
        items = await self.session.scalars(
            select(PurchaseItem).where(PurchaseItem.purchase_id == purchase.id)
        )
        for item in items:
            await self.inventory.apply_movement(
                variant_id=item.variant_id,
                quantity_delta=item.quantity,
                movement_type="PURCHASE_RECEIPT",
                note=f"Purchase {purchase.reference}",
                reference_type="purchase",
                reference_id=purchase.id,
            )
        purchase.status = "RECEIVED"
        add_audit(self.session, self.user, "purchase.received", "purchase", purchase.id)
        await self.session.commit()
        return self._purchase_view(purchase)

    @staticmethod
    def _purchase_view(purchase: Purchase) -> PurchaseView:
        return PurchaseView(
            id=purchase.id,
            reference=purchase.reference,
            supplier_id=purchase.supplier_id,
            status=purchase.status,
            total=purchase.total,
            created_at=purchase.created_at,
        )
