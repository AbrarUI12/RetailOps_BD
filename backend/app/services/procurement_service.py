import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.models.entities import (
    Order,
    Purchase,
    PurchaseItem,
    Return,
    ReturnItem,
    Sale,
    Supplier,
    User,
)
from app.schemas.operations import (
    PurchaseCreate,
    PurchaseView,
    ReturnCreate,
    SupplierCreate,
    SupplierView,
)
from app.services.audit_service import add_audit
from app.services.inventory_service import InventoryService

# Sellable returns go back on the shelf; damaged and missing units are recorded in the
# ledger with no change to sellable stock so every returned unit has an explicit trail.
RETURN_EFFECTS: dict[str, tuple[str, bool]] = {
    "SELLABLE": ("RETURN_SELLABLE", True),
    "DAMAGED": ("RETURN_DAMAGED", False),
    "MISSING": ("RETURN_MISSING", False),
}


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

    async def receive_return(self, command: ReturnCreate) -> dict[str, object]:
        if not command.order_id and not command.sale_id:
            raise AppError(
                "RETURN_REFERENCE_REQUIRED", "Order or sale is required", status_code=422
            )
        if command.order_id and not await self.session.scalar(
            select(Order.id).where(
                Order.id == command.order_id,
                Order.organization_id == self.user.organization_id,
            )
        ):
            raise AppError("ORDER_NOT_FOUND", "Order was not found", status_code=404)
        if command.sale_id and not await self.session.scalar(
            select(Sale.id).where(
                Sale.id == command.sale_id,
                Sale.organization_id == self.user.organization_id,
            )
        ):
            raise AppError("SALE_NOT_FOUND", "Sale was not found", status_code=404)
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
        for line in command.items:
            self.session.add(
                ReturnItem(
                    organization_id=self.user.organization_id,
                    return_id=returned.id,
                    **line.model_dump(),
                )
            )
            movement_type, restock = RETURN_EFFECTS[line.disposition]
            await self.inventory.apply_movement(
                variant_id=line.variant_id,
                quantity_delta=line.quantity if restock else 0,
                movement_type=movement_type,
                note=f"{command.reason} ({line.quantity} {line.disposition.lower()})",
                reference_type="return",
                reference_id=returned.id,
            )
        add_audit(self.session, self.user, "return.received", "return", returned.id)
        await self.session.commit()
        return {"id": str(returned.id), "status": returned.status}

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
