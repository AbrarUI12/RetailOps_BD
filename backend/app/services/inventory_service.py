import uuid
from typing import Literal

from sqlalchemy import ColumnElement, Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.models.entities import (
    Category,
    InventoryBalance,
    InventoryMovement,
    Product,
    ProductVariant,
    User,
)
from app.schemas.inventory import (
    REASON_LABELS,
    InventoryAdjustment,
    InventoryDetail,
    InventoryPage,
    InventoryView,
    MovementView,
)
from app.services.audit_service import add_audit

StockStatus = Literal["in_stock", "low", "out", "reorder"]


def stock_status(available: int, reorder_level: int) -> str:
    if available <= 0:
        return "OUT_OF_STOCK"
    if available <= reorder_level:
        return "LOW_STOCK"
    return "IN_STOCK"


class InventoryService:
    def __init__(self, session: AsyncSession, user: User) -> None:
        self.session = session
        self.user = user

    def _rows_query(
        self,
    ) -> tuple[Select[ProductVariant, Product, str, int, int], ColumnElement[int]]:
        physical: ColumnElement[int] = func.coalesce(InventoryBalance.physical_quantity, 0)
        reserved: ColumnElement[int] = func.coalesce(InventoryBalance.reserved_quantity, 0)
        return (
            select(ProductVariant, Product, Category.name, physical, reserved)
            .join(Product, Product.id == ProductVariant.product_id)
            .outerjoin(Category, Category.id == Product.category_id)
            .outerjoin(
                InventoryBalance,
                (InventoryBalance.variant_id == ProductVariant.id)
                & (InventoryBalance.branch_id == self.user.branch_id),
            )
            .where(ProductVariant.organization_id == self.user.organization_id)
        ), physical - reserved

    @staticmethod
    def _view(
        variant: ProductVariant,
        product: Product,
        category: str | None,
        physical: int,
        reserved: int,
    ) -> InventoryView:
        available = physical - reserved
        return InventoryView(
            variant_id=variant.id,
            product_id=product.id,
            product_name=product.name,
            variant_name=variant.name,
            category_name=category,
            sku=variant.sku,
            barcode=variant.barcode,
            physical_quantity=physical,
            reserved_quantity=reserved,
            available_quantity=available,
            reorder_level=variant.reorder_level,
            stock_status=stock_status(available, variant.reorder_level),
        )

    async def list_inventory(
        self,
        *,
        search: str | None = None,
        status: StockStatus | None = None,
        category_id: uuid.UUID | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> InventoryPage:
        query, available = self._rows_query()
        query = query.where(ProductVariant.is_active.is_(True))
        if search and search.strip():
            term = f"%{search.strip()}%"
            query = query.where(
                or_(
                    Product.name.ilike(term),
                    ProductVariant.name.ilike(term),
                    ProductVariant.sku.ilike(term),
                    ProductVariant.barcode == search.strip(),
                )
            )
        if category_id:
            query = query.where(Product.category_id == category_id)
        if status == "out":
            query = query.where(available <= 0)
        elif status == "low":
            query = query.where(available > 0, available <= ProductVariant.reorder_level)
        elif status == "reorder":
            # Everything that needs restocking: low and out of stock together.
            query = query.where(available <= ProductVariant.reorder_level)
        elif status == "in_stock":
            query = query.where(available > ProductVariant.reorder_level)
        total = await self.session.scalar(select(func.count()).select_from(query.subquery())) or 0
        rows = await self.session.execute(
            query.order_by(Product.name, ProductVariant.name)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return InventoryPage(
            items=[self._view(v, p, c, ph, rs) for v, p, c, ph, rs in rows.all()],
            page=page,
            page_size=page_size,
            total=total,
        )

    async def item(self, variant_id: uuid.UUID) -> InventoryView:
        query, _ = self._rows_query()
        row = (await self.session.execute(query.where(ProductVariant.id == variant_id))).first()
        if row is None:
            raise AppError("VARIANT_NOT_FOUND", "Product variant was not found", status_code=404)
        variant, product, category, physical, reserved = row
        return self._view(variant, product, category, physical, reserved)

    async def detail(self, variant_id: uuid.UUID) -> InventoryDetail:
        return InventoryDetail(
            item=await self.item(variant_id), movements=await self.movements(variant_id, limit=50)
        )

    async def adjust(self, command: InventoryAdjustment) -> InventoryView:
        current = await self.item(command.variant_id)
        delta = (
            command.quantity_delta
            if command.quantity_delta is not None
            else (command.counted_quantity or 0) - current.physical_quantity
        )
        if delta == 0:
            raise AppError(
                "NO_STOCK_CHANGE",
                "The counted quantity matches the recorded stock; nothing to adjust",
                status_code=422,
            )
        reason = REASON_LABELS[command.reason]
        await self.apply_movement(
            variant_id=command.variant_id,
            quantity_delta=delta,
            movement_type="DAMAGED" if command.reason == "DAMAGED" else "MANUAL_ADJUSTMENT",
            note=f"{reason}: {command.note}",
        )
        add_audit(
            self.session,
            self.user,
            "inventory.adjusted",
            "product_variant",
            command.variant_id,
            old_data={"physical_quantity": current.physical_quantity},
            new_data={
                "physical_quantity": current.physical_quantity + delta,
                "quantity_delta": delta,
                "reason": command.reason,
                "note": command.note,
            },
        )
        await self.session.commit()
        return await self.item(command.variant_id)

    async def apply_movement(
        self,
        *,
        variant_id: uuid.UUID,
        quantity_delta: int,
        movement_type: str,
        note: str | None,
        reference_type: str | None = None,
        reference_id: uuid.UUID | None = None,
        allow_negative: bool = False,
    ) -> InventoryMovement:
        variant = await self.session.scalar(
            select(ProductVariant).where(
                ProductVariant.id == variant_id,
                ProductVariant.organization_id == self.user.organization_id,
            )
        )
        if variant is None:
            raise AppError("VARIANT_NOT_FOUND", "Product variant was not found", status_code=404)
        balance = await self.session.scalar(
            select(InventoryBalance)
            .where(
                InventoryBalance.branch_id == self.user.branch_id,
                InventoryBalance.variant_id == variant_id,
            )
            .with_for_update()
        )
        if balance is None:
            balance = InventoryBalance(
                organization_id=self.user.organization_id,
                branch_id=self.user.branch_id,
                variant_id=variant_id,
                physical_quantity=0,
                reserved_quantity=0,
            )
            self.session.add(balance)
            await self.session.flush()
        previous = balance.physical_quantity
        new_quantity = previous + quantity_delta
        if new_quantity < balance.reserved_quantity and not allow_negative:
            raise AppError(
                "INSUFFICIENT_STOCK",
                "Insufficient inventory: "
                f"{balance.available_quantity} available, {-quantity_delta} requested",
                status_code=409,
                details={"variant_id": str(variant_id), "available": balance.available_quantity},
            )
        balance.physical_quantity = new_quantity
        movement = InventoryMovement(
            organization_id=self.user.organization_id,
            branch_id=self.user.branch_id,
            variant_id=variant_id,
            movement_type=movement_type,
            quantity_delta=quantity_delta,
            previous_quantity=previous,
            new_quantity=new_quantity,
            reference_type=reference_type,
            reference_id=reference_id,
            created_by=self.user.id,
            note=note,
        )
        self.session.add(movement)
        return movement

    async def _locked_balance(
        self, variant_id: uuid.UUID, branch_id: uuid.UUID
    ) -> InventoryBalance | None:
        return await self.session.scalar(
            select(InventoryBalance)
            .where(
                InventoryBalance.organization_id == self.user.organization_id,
                InventoryBalance.branch_id == branch_id,
                InventoryBalance.variant_id == variant_id,
            )
            .with_for_update()
        )

    async def reserve(self, *, variant_id: uuid.UUID, branch_id: uuid.UUID, quantity: int) -> None:
        """Hold available stock for a confirmed order; physical stock is unchanged."""
        balance = await self._locked_balance(variant_id, branch_id)
        available = balance.available_quantity if balance else 0
        if balance is None or available < quantity:
            raise AppError(
                "INSUFFICIENT_STOCK",
                f"Insufficient inventory: {available} available, {quantity} requested",
                status_code=409,
                details={"variant_id": str(variant_id), "available": available},
            )
        balance.reserved_quantity += quantity

    async def release(self, *, variant_id: uuid.UUID, branch_id: uuid.UUID, quantity: int) -> None:
        balance = await self._locked_balance(variant_id, branch_id)
        if balance:
            balance.reserved_quantity = max(0, balance.reserved_quantity - quantity)

    async def movements(
        self, variant_id: uuid.UUID | None = None, *, limit: int = 200
    ) -> list[MovementView]:
        query = (
            select(InventoryMovement, User.full_name)
            .outerjoin(User, User.id == InventoryMovement.created_by)
            .where(
                InventoryMovement.organization_id == self.user.organization_id,
                InventoryMovement.branch_id == self.user.branch_id,
            )
        )
        if variant_id:
            query = query.where(InventoryMovement.variant_id == variant_id)
        rows = await self.session.execute(
            query.order_by(InventoryMovement.created_at.desc()).limit(limit)
        )
        return [
            MovementView(
                id=item.id,
                variant_id=item.variant_id,
                movement_type=item.movement_type,
                quantity_delta=item.quantity_delta,
                previous_quantity=item.previous_quantity,
                new_quantity=item.new_quantity,
                note=item.note,
                reference_type=item.reference_type,
                reference_id=item.reference_id,
                created_by_name=name,
                created_at=item.created_at,
            )
            for item, name in rows.all()
        ]
