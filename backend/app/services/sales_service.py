import uuid
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.models.entities import Payment, Product, ProductVariant, Sale, SaleItem, User
from app.schemas.sales import CreateSaleRequest, SaleLineView, SaleView
from app.services.audit_service import add_audit
from app.services.inventory_service import InventoryService

MONEY = Decimal("0.01")


class SalesService:
    def __init__(self, session: AsyncSession, user: User) -> None:
        self.session = session
        self.user = user
        self.inventory = InventoryService(session, user)

    async def create(self, command: CreateSaleRequest, *, synced_offline: bool = False) -> SaleView:
        if command.client_transaction_id:
            existing = await self.session.scalar(
                select(Sale).where(
                    Sale.organization_id == self.user.organization_id,
                    Sale.client_transaction_id == command.client_transaction_id,
                )
            )
            if existing:
                return self._view(existing, idempotent_replay=True)

        variant_ids = [item.variant_id for item in command.items]
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
        if len(catalog) != len(variant_ids):
            raise AppError(
                "INVALID_SALE_ITEM", "One or more sale items are unavailable", status_code=422
            )

        subtotal = sum(
            (catalog[item.variant_id][0].price * item.quantity for item in command.items),
            Decimal("0"),
        ).quantize(MONEY)
        if command.discount > subtotal:
            raise AppError("INVALID_DISCOUNT", "Discount cannot exceed subtotal", status_code=422)
        total = (subtotal - command.discount).quantize(MONEY)
        if command.amount_received < total:
            raise AppError(
                "INSUFFICIENT_PAYMENT", "Amount received is below the sale total", status_code=422
            )

        sale = Sale(
            organization_id=self.user.organization_id,
            branch_id=self.user.branch_id,
            cashier_id=self.user.id,
            customer_id=command.customer_id,
            invoice_number=self._invoice_number(),
            client_transaction_id=command.client_transaction_id,
            subtotal=subtotal,
            discount=command.discount,
            total=total,
            synced_offline=synced_offline,
            items=[],
            payments=[],
        )
        self.session.add(sale)
        await self.session.flush()
        conflict = False
        for item in command.items:
            variant, product = catalog[item.variant_id]
            line_total = (variant.price * item.quantity).quantize(MONEY)
            sale.items.append(
                SaleItem(
                    organization_id=self.user.organization_id,
                    variant_id=variant.id,
                    product_name=product.name,
                    variant_name=variant.name,
                    sku=variant.sku,
                    quantity=item.quantity,
                    unit_price=variant.price,
                    unit_cost=variant.cost,
                    line_total=line_total,
                )
            )
            try:
                movement = await self.inventory.apply_movement(
                    variant_id=variant.id,
                    quantity_delta=-item.quantity,
                    movement_type="OFFLINE_SYNC" if synced_offline else "SALE",
                    note=f"Sale {sale.invoice_number}",
                    reference_type="sale",
                    reference_id=sale.id,
                    allow_negative=command.allow_inventory_conflict,
                )
                if movement.new_quantity < 0:
                    conflict = True
            except AppError as exc:
                if exc.code != "INSUFFICIENT_STOCK" or not command.allow_inventory_conflict:
                    raise
                conflict = True
        sale.payments.append(
            Payment(
                organization_id=self.user.organization_id,
                method=command.payment_method,
                amount=command.amount_received,
            )
        )
        add_audit(
            self.session,
            self.user,
            "sale.created",
            "sale",
            sale.id,
            new_data={"invoice_number": sale.invoice_number, "total": str(total)},
        )
        await self.session.commit()
        created = await self.session.scalar(select(Sale).where(Sale.id == sale.id))
        assert created is not None
        return self._view(created, inventory_conflict=conflict)

    async def get(self, sale_id: uuid.UUID) -> SaleView:
        sale = await self.session.scalar(
            select(Sale).where(
                Sale.id == sale_id,
                Sale.organization_id == self.user.organization_id,
            )
        )
        if sale is None:
            raise AppError("SALE_NOT_FOUND", "Sale was not found", status_code=404)
        return self._view(sale)

    def _view(
        self,
        sale: Sale,
        *,
        idempotent_replay: bool = False,
        inventory_conflict: bool = False,
    ) -> SaleView:
        payment = sale.payments[0]
        return SaleView(
            id=sale.id,
            invoice_number=sale.invoice_number,
            subtotal=sale.subtotal,
            discount=sale.discount,
            total=sale.total,
            payment_method=payment.method,
            amount_received=payment.amount,
            change_due=max(Decimal("0"), payment.amount - sale.total),
            created_at=sale.created_at,
            items=[
                SaleLineView(
                    variant_id=item.variant_id,
                    product_name=item.product_name,
                    variant_name=item.variant_name,
                    sku=item.sku,
                    quantity=item.quantity,
                    unit_price=item.unit_price,
                    line_total=item.line_total,
                )
                for item in sale.items
            ],
            idempotent_replay=idempotent_replay,
            inventory_conflict=inventory_conflict,
        )

    @staticmethod
    def _invoice_number() -> str:
        now = datetime.now(UTC)
        return f"POS-{now:%Y%m%d}-{now:%H%M%S}-{uuid.uuid4().hex[:4].upper()}"
