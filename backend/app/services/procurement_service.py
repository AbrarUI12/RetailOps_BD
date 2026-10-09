import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.models.entities import (
    Product,
    ProductVariant,
    Purchase,
    PurchaseItem,
    Supplier,
    User,
)
from app.schemas.operations import (
    PurchaseCreate,
    PurchaseItemView,
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
        supplier = Supplier(
            organization_id=self.user.organization_id,
            name=command.name.strip(),
            phone=command.phone.strip() if command.phone else None,
            email=command.email.strip().lower() if command.email else None,
        )
        self.session.add(supplier)
        await self.session.flush()
        add_audit(
            self.session,
            self.user,
            "supplier.created",
            "supplier",
            supplier.id,
            new_data={"name": supplier.name},
        )
        await self.session.commit()
        return SupplierView.model_validate(supplier)

    async def purchases(self) -> list[PurchaseView]:
        purchases = await self.session.scalars(
            select(Purchase)
            .where(Purchase.organization_id == self.user.organization_id)
            .order_by(Purchase.created_at.desc())
        )
        return [await self._purchase_view(purchase) for purchase in purchases]

    async def create_purchase(self, command: PurchaseCreate) -> PurchaseView:
        supplier = await self.session.scalar(
            select(Supplier).where(
                Supplier.id == command.supplier_id,
                Supplier.organization_id == self.user.organization_id,
            )
        )
        if supplier is None:
            raise AppError("SUPPLIER_NOT_FOUND", "Supplier was not found", status_code=404)
        variant_ids = [line.variant_id for line in command.items]
        if len(variant_ids) != len(set(variant_ids)):
            raise AppError(
                "DUPLICATE_PURCHASE_ITEM",
                "Each product variant can appear only once in a purchase",
                status_code=422,
            )
        valid_variants = set(
            await self.session.scalars(
                select(ProductVariant.id).where(
                    ProductVariant.id.in_(variant_ids),
                    ProductVariant.organization_id == self.user.organization_id,
                )
            )
        )
        if valid_variants != set(variant_ids):
            raise AppError(
                "VARIANT_NOT_FOUND",
                "One or more product variants were not found",
                status_code=404,
            )
        total = sum((line.unit_cost * line.quantity for line in command.items), Decimal("0"))
        purchase = Purchase(
            organization_id=self.user.organization_id,
            branch_id=self.user.branch_id,
            supplier_id=supplier.id,
            reference=command.reference.strip(),
            status="DRAFT",
            total=total,
        )
        self.session.add(purchase)
        try:
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
            add_audit(
                self.session,
                self.user,
                "purchase.created",
                "purchase",
                purchase.id,
                new_data={
                    "reference": purchase.reference,
                    "supplier_id": supplier.id,
                    "total": total,
                    "item_count": len(command.items),
                },
            )
            await self.session.commit()
        except IntegrityError as error:
            await self.session.rollback()
            raise AppError(
                "DUPLICATE_PURCHASE_REFERENCE",
                "A purchase with this reference already exists",
                status_code=409,
            ) from error
        return await self._purchase_view(purchase)

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
            return await self._purchase_view(purchase)
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
                branch_id=purchase.branch_id,
            )
        purchase.status = "RECEIVED"
        add_audit(self.session, self.user, "purchase.received", "purchase", purchase.id)
        await self.session.commit()
        return await self._purchase_view(purchase)

    async def _purchase_view(self, purchase: Purchase) -> PurchaseView:
        supplier_name = await self.session.scalar(
            select(Supplier.name).where(
                Supplier.id == purchase.supplier_id,
                Supplier.organization_id == self.user.organization_id,
            )
        )
        rows = await self.session.execute(
            select(PurchaseItem, ProductVariant, Product)
            .join(ProductVariant, ProductVariant.id == PurchaseItem.variant_id)
            .join(Product, Product.id == ProductVariant.product_id)
            .where(
                PurchaseItem.purchase_id == purchase.id,
                PurchaseItem.organization_id == self.user.organization_id,
            )
            .order_by(Product.name, ProductVariant.name)
        )
        return PurchaseView(
            id=purchase.id,
            reference=purchase.reference,
            supplier_id=purchase.supplier_id,
            supplier_name=supplier_name or "Unknown supplier",
            branch_id=purchase.branch_id,
            status=purchase.status,
            total=purchase.total,
            created_at=purchase.created_at,
            items=[
                PurchaseItemView(
                    variant_id=item.variant_id,
                    product_name=product.name,
                    variant_name=variant.name,
                    sku=variant.sku,
                    quantity=item.quantity,
                    unit_cost=item.unit_cost,
                    line_total=item.unit_cost * item.quantity,
                )
                for item, variant, product in rows.all()
            ],
        )
