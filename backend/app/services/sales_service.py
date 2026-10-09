import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.models.entities import (
    Customer,
    Payment,
    PaymentMethod,
    Product,
    ProductVariant,
    Sale,
    SaleItem,
    User,
)
from app.schemas.sales import (
    CreateSaleRequest,
    OfflineSalePayload,
    PaymentLine,
    PaymentView,
    SaleLineView,
    SaleView,
)
from app.services.audit_service import add_audit
from app.services.inventory_service import InventoryService

MONEY = Decimal("0.01")
# A device clock may drift; anything further in the future than this is clamped to "now".
MAX_CLOCK_SKEW = timedelta(minutes=5)


@dataclass
class SaleOutcome:
    view: SaleView
    price_mismatches: list[dict[str, str]] = field(default_factory=list)
    oversold: list[dict[str, str | int]] = field(default_factory=list)


class SalesService:
    def __init__(self, session: AsyncSession, user: User) -> None:
        self.session = session
        self.user = user
        self.inventory = InventoryService(session, user)

    async def create(self, command: CreateSaleRequest) -> SaleView:
        """Online POS sale: current prices, active variants, never below available stock."""
        try:
            return (await self._create(command, offline=False)).view
        except Exception:
            # The sale aggregate is all-or-nothing: a later stock failure must also
            # discard the sale, its earlier line movements, payments and audit row.
            await self.session.rollback()
            raise

    async def create_offline(self, command: OfflineSalePayload) -> SaleOutcome:
        """Import a sale the device already completed: keep its time and the prices paid,
        and record (rather than refuse) stock or price disagreements."""
        return await self._create(command, offline=True)

    async def _replay(self, client_transaction_id: uuid.UUID | None) -> SaleView | None:
        if client_transaction_id is None:
            return None
        existing = await self.session.scalar(
            select(Sale).where(
                Sale.organization_id == self.user.organization_id,
                Sale.client_transaction_id == client_transaction_id,
            )
        )
        return self._view(existing, idempotent_replay=True) if existing else None

    async def _create(self, command: CreateSaleRequest, *, offline: bool) -> SaleOutcome:
        replay = await self._replay(command.client_transaction_id)
        if replay:
            return SaleOutcome(replay)
        if command.customer_id and not await self.session.scalar(
            select(Customer.id).where(
                Customer.id == command.customer_id,
                Customer.organization_id == self.user.organization_id,
            )
        ):
            raise AppError("CUSTOMER_NOT_FOUND", "Customer was not found", status_code=404)

        variant_ids = [item.variant_id for item in command.items]
        query = (
            select(ProductVariant, Product)
            .join(Product, Product.id == ProductVariant.product_id)
            .where(
                ProductVariant.organization_id == self.user.organization_id,
                ProductVariant.id.in_(variant_ids),
            )
        )
        if not offline:
            # A sale that already happened offline is imported even if the variant was
            # deactivated since; new online sales only sell active variants.
            query = query.where(ProductVariant.is_active.is_(True))
        catalog = {
            variant.id: (variant, product)
            for variant, product in (await self.session.execute(query)).all()
        }
        if len(catalog) != len(variant_ids):
            raise AppError(
                "INVALID_SALE_ITEM", "One or more sale items are unavailable", status_code=422
            )

        prices: dict[uuid.UUID, Decimal] = {}
        mismatches: list[dict[str, str]] = []
        for item in command.items:
            variant = catalog[item.variant_id][0]
            paid = getattr(item, "unit_price", None) if offline else None
            prices[item.variant_id] = paid if paid is not None else variant.price
            if paid is not None and paid != variant.price:
                mismatches.append(
                    {"sku": variant.sku, "paid": str(paid), "catalog": str(variant.price)}
                )

        subtotal = sum(
            (prices[item.variant_id] * item.quantity for item in command.items), Decimal("0")
        ).quantize(MONEY)
        if command.discount > subtotal:
            raise AppError("INVALID_DISCOUNT", "Discount cannot exceed subtotal", status_code=422)
        total = (subtotal - command.discount).quantize(MONEY)
        payments, received = self._payments(command, total, self.user.organization_id)

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
            amount_received=received,
            synced_offline=offline,
            items=[],
            payments=payments,
        )
        if offline:
            now = datetime.now(UTC)
            sale.synced_at = now
            happened = getattr(command, "offline_created_at", None)
            if happened is not None:
                happened = happened if happened.tzinfo else happened.replace(tzinfo=UTC)
                sale.created_at = min(happened, now + MAX_CLOCK_SKEW)
        self.session.add(sale)
        await self.session.flush()
        oversold: list[dict[str, str | int]] = []
        for item in command.items:
            variant, product = catalog[item.variant_id]
            unit_price = prices[item.variant_id]
            sale.items.append(
                SaleItem(
                    organization_id=self.user.organization_id,
                    variant_id=variant.id,
                    product_name=product.name,
                    variant_name=variant.name,
                    sku=variant.sku,
                    quantity=item.quantity,
                    unit_price=unit_price,
                    unit_cost=variant.cost,
                    line_total=(unit_price * item.quantity).quantize(MONEY),
                )
            )
            movement = await self.inventory.apply_movement(
                variant_id=variant.id,
                quantity_delta=-item.quantity,
                movement_type="OFFLINE_SYNC" if offline else "SALE",
                note=f"Sale {sale.invoice_number}",
                reference_type="sale",
                reference_id=sale.id,
                allow_negative=offline,
            )
            if movement.new_quantity < 0:
                oversold.append(
                    {
                        "variant_id": str(variant.id),
                        "sku": variant.sku,
                        "product": f"{product.name} · {variant.name}",
                        "quantity_sold": item.quantity,
                        "stock_before": movement.previous_quantity,
                        "stock_after": movement.new_quantity,
                    }
                )
        add_audit(
            self.session,
            self.user,
            "sale.created",
            "sale",
            sale.id,
            new_data={
                "invoice_number": sale.invoice_number,
                "total": str(total),
                "offline": offline,
                "price_mismatches": mismatches or None,
            },
        )
        try:
            await self.session.commit()
        except IntegrityError:
            # Two requests with the same client_transaction_id raced; the other one won.
            await self.session.rollback()
            replay = await self._replay(command.client_transaction_id)
            if replay is None:
                raise
            return SaleOutcome(replay)
        return SaleOutcome(
            self._view(sale, inventory_conflict=bool(oversold), price_mismatch=bool(mismatches)),
            mismatches,
            oversold,
        )

    @staticmethod
    def _payments(
        command: CreateSaleRequest, total: Decimal, organization_id: uuid.UUID
    ) -> tuple[list[Payment], Decimal]:
        """Payment rows hold the amount applied to the sale; only cash can produce change."""
        lines = (
            command.payments
            if command.payment_method == PaymentMethod.SPLIT and command.payments
            else [PaymentLine(method=command.payment_method, amount=command.amount_received)]
        )
        received = sum((line.amount for line in lines), Decimal("0")).quantize(MONEY)
        if received < total:
            raise AppError(
                "INSUFFICIENT_PAYMENT", "Amount received is below the sale total", status_code=422
            )
        change = received - total
        non_cash = sum(
            (line.amount for line in lines if line.method != PaymentMethod.CASH), Decimal("0")
        )
        if non_cash > total:
            raise AppError(
                "OVERPAID_NON_CASH",
                "Card and mobile payments cannot exceed the sale total",
                status_code=422,
            )
        rows: list[Payment] = []
        for line in lines:
            applied = line.amount
            if line.method == PaymentMethod.CASH and change:
                taken = min(change, applied)
                applied -= taken
                change -= taken
            if applied > 0:
                rows.append(
                    Payment(organization_id=organization_id, method=line.method, amount=applied)
                )
        return rows, received

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
        price_mismatch: bool = False,
    ) -> SaleView:
        payments = [PaymentView(method=p.method, amount=p.amount) for p in sale.payments]
        method = payments[0].method if len(payments) == 1 else PaymentMethod.SPLIT
        return SaleView(
            id=sale.id,
            invoice_number=sale.invoice_number,
            subtotal=sale.subtotal,
            discount=sale.discount,
            total=sale.total,
            payment_method=method,
            payments=payments,
            amount_received=sale.amount_received,
            change_due=max(Decimal("0"), sale.amount_received - sale.total),
            created_at=sale.created_at,
            synced_offline=sale.synced_offline,
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
            price_mismatch=price_mismatch,
        )

    @staticmethod
    def _invoice_number() -> str:
        now = datetime.now(UTC)
        return f"POS-{now:%Y%m%d}-{now:%H%M%S}-{uuid.uuid4().hex[:4].upper()}"
