import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.models.entities import (
    InventoryBalance,
    InventoryMovement,
    Product,
    ProductVariant,
    User,
)
from app.schemas.inventory import InventoryAdjustment, InventoryView, MovementView
from app.services.audit_service import add_audit


class InventoryService:
    def __init__(self, session: AsyncSession, user: User) -> None:
        self.session = session
        self.user = user

    async def list_inventory(self) -> list[InventoryView]:
        rows = (
            await self.session.execute(
                select(ProductVariant, Product, InventoryBalance)
                .join(Product, Product.id == ProductVariant.product_id)
                .outerjoin(
                    InventoryBalance,
                    (InventoryBalance.variant_id == ProductVariant.id)
                    & (InventoryBalance.branch_id == self.user.branch_id),
                )
                .where(ProductVariant.organization_id == self.user.organization_id)
                .order_by(Product.name, ProductVariant.name)
            )
        ).all()
        result: list[InventoryView] = []
        for variant, product, balance in rows:
            physical = balance.physical_quantity if balance else 0
            reserved = balance.reserved_quantity if balance else 0
            available = physical - reserved
            status = (
                "OUT_OF_STOCK"
                if available <= 0
                else "LOW_STOCK"
                if available <= variant.reorder_level
                else "IN_STOCK"
            )
            result.append(
                InventoryView(
                    variant_id=variant.id,
                    product_name=product.name,
                    variant_name=variant.name,
                    sku=variant.sku,
                    barcode=variant.barcode,
                    physical_quantity=physical,
                    reserved_quantity=reserved,
                    available_quantity=available,
                    reorder_level=variant.reorder_level,
                    stock_status=status,
                )
            )
        return result

    async def adjust(self, command: InventoryAdjustment) -> InventoryView:
        await self.apply_movement(
            variant_id=command.variant_id,
            quantity_delta=command.quantity_delta,
            movement_type="MANUAL_ADJUSTMENT",
            note=f"{command.reason}: {command.note}",
        )
        add_audit(
            self.session,
            self.user,
            "inventory.adjusted",
            "product_variant",
            command.variant_id,
            new_data={"quantity_delta": command.quantity_delta, "reason": command.reason},
        )
        await self.session.commit()
        return next(
            item for item in await self.list_inventory() if item.variant_id == command.variant_id
        )

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

    async def movements(self, variant_id: uuid.UUID | None = None) -> list[MovementView]:
        query = select(InventoryMovement).where(
            InventoryMovement.organization_id == self.user.organization_id,
            InventoryMovement.branch_id == self.user.branch_id,
        )
        if variant_id:
            query = query.where(InventoryMovement.variant_id == variant_id)
        movements = await self.session.scalars(
            query.order_by(InventoryMovement.created_at.desc()).limit(200)
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
                created_at=item.created_at,
            )
            for item in movements
        ]
