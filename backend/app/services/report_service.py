import csv
import io
import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.models.entities import (
    Branch,
    InventoryBalance,
    Order,
    OrderStatus,
    PaymentMethod,
    Product,
    ProductVariant,
    ReturnItem,
    Sale,
    SaleItem,
    Shipment,
    User,
)
from app.models.entities import (
    Return as ReturnRecord,
)
from app.schemas.reports import (
    CourierSummary,
    DashboardBranch,
    DashboardKpis,
    DashboardProduct,
    DashboardReport,
    InventorySummary,
    LowStockItem,
    OutcomeSummary,
    ProductPerformance,
    RecentOrder,
    RecentSale,
    RevenuePoint,
    SalesSummary,
    SummaryReport,
)
from app.utils.time import BUSINESS_TZ, as_utc, business_day_start

MAX_REPORT_DAYS = 366
RETURNED_STATUSES = {OrderStatus.RETURNED, OrderStatus.FAILED_DELIVERY}
IN_TRANSIT_STATUSES = {OrderStatus.SHIPPED, OrderStatus.RETURN_REQUESTED}
MONEY = Decimal("0.01")


def _rate(part: int, whole: int) -> float | None:
    return round(part / whole, 4) if whole else None


def _paid_line_value(sale: Sale, item: SaleItem, quantity: int) -> Decimal:
    """Allocate the sale-level discount to a line using its share of the subtotal."""
    if not sale.subtotal:
        return Decimal("0.00")
    return (item.unit_price * quantity * sale.total / sale.subtotal).quantize(MONEY)


class ReportService:
    def __init__(self, session: AsyncSession, user: User) -> None:
        self.session = session
        self.user = user

    async def dashboard(
        self, start_day: date, end_day: date, branch_id: uuid.UUID | None = None
    ) -> DashboardReport:
        start, until = self.window(start_day, end_day)
        selected_branch = branch_id or self.user.branch_id
        branches = list(
            await self.session.scalars(
                select(Branch)
                .where(Branch.organization_id == self.user.organization_id)
                .order_by(Branch.name)
            )
        )
        if selected_branch not in {branch.id for branch in branches}:
            raise AppError("BRANCH_NOT_FOUND", "Branch was not found", status_code=404)
        sales = list(
            await self.session.scalars(
                select(Sale)
                .where(
                    Sale.organization_id == self.user.organization_id,
                    Sale.branch_id == selected_branch,
                    Sale.created_at >= start,
                    Sale.created_at < until,
                )
                .order_by(Sale.created_at.desc())
            )
        )
        orders = list(
            await self.session.scalars(
                select(Order)
                .where(
                    Order.organization_id == self.user.organization_id,
                    Order.branch_id == selected_branch,
                    Order.created_at >= start,
                    Order.created_at < until,
                )
                .order_by(Order.created_at.desc())
            )
        )
        revenue = sum((sale.total for sale in sales), Decimal("0.00"))
        costs = sum(
            (item.unit_cost * item.quantity for sale in sales for item in sale.items),
            Decimal("0.00"),
        )
        stock_rows = (
            await self.session.execute(
                select(InventoryBalance, ProductVariant, Product)
                .join(ProductVariant, ProductVariant.id == InventoryBalance.variant_id)
                .join(Product, Product.id == ProductVariant.product_id)
                .where(
                    InventoryBalance.organization_id == self.user.organization_id,
                    InventoryBalance.branch_id == selected_branch,
                    Product.is_active.is_(True),
                    ProductVariant.is_active.is_(True),
                    (InventoryBalance.physical_quantity - InventoryBalance.reserved_quantity)
                    <= ProductVariant.reorder_level,
                )
                .order_by(
                    (InventoryBalance.physical_quantity - InventoryBalance.reserved_quantity),
                    Product.name,
                )
            )
        ).all()
        hourly: list[RevenuePoint] = []
        if start_day == end_day:
            for hour in range(0, 24, 4):
                point_start = start + timedelta(hours=hour)
                point_end = point_start + timedelta(hours=4)
                point_total = sum(
                    (
                        sale.total
                        for sale in sales
                        if point_start <= as_utc(sale.created_at) < point_end
                    ),
                    Decimal("0.00"),
                )
                label = point_start.astimezone(BUSINESS_TZ).strftime("%I %p").lstrip("0")
                hourly.append(RevenuePoint(label=label, revenue=point_total))
        else:
            day = start_day
            while day <= end_day:
                day_start = business_day_start(day)
                day_end = day_start + timedelta(days=1)
                hourly.append(
                    RevenuePoint(
                        label=day.strftime("%d %b").lstrip("0"),
                        revenue=sum(
                            (
                                sale.total
                                for sale in sales
                                if day_start <= as_utc(sale.created_at) < day_end
                            ),
                            Decimal("0.00"),
                        ),
                    )
                )
                day += timedelta(days=1)
        product_rows: dict[tuple[str, str], DashboardProduct] = {}
        for sale in sales:
            for item in sale.items:
                key = (item.product_name, item.variant_name)
                row = product_rows.setdefault(
                    key,
                    DashboardProduct(
                        product_name=item.product_name,
                        variant_name=item.variant_name,
                        quantity=0,
                        revenue=Decimal("0.00"),
                    ),
                )
                row.quantity += item.quantity
                row.revenue += item.line_total
        terminal = [
            order for order in orders if order.status in {OrderStatus.DELIVERED, *RETURNED_STATUSES}
        ]
        delivered = sum(order.status == OrderStatus.DELIVERED for order in terminal)
        count = len(sales)
        return DashboardReport(
            start=start_day,
            end=end_day,
            branch_id=selected_branch,
            branches=[DashboardBranch(id=branch.id, name=branch.name) for branch in branches],
            kpis=DashboardKpis(
                revenue=revenue,
                sales=count,
                orders=len(orders),
                gross_profit=revenue - costs,
                average_order_value=revenue / count if count else Decimal("0.00"),
                pending_orders=sum(
                    order.status == OrderStatus.PENDING_CONFIRMATION for order in orders
                ),
                low_stock=len(stock_rows),
            ),
            revenue_series=hourly,
            orders_by_source=dict(Counter(order.source.value for order in orders)),
            top_products=sorted(product_rows.values(), key=lambda row: row.revenue, reverse=True)[
                :5
            ],
            low_stock_items=[
                LowStockItem(
                    variant_id=variant.id,
                    product_name=product.name,
                    variant_name=variant.name,
                    sku=variant.sku,
                    available_quantity=balance.available_quantity,
                    reorder_level=variant.reorder_level,
                )
                for balance, variant, product in stock_rows[:6]
            ],
            recent_sales=[
                RecentSale(
                    id=sale.id,
                    invoice_number=sale.invoice_number,
                    total=sale.total,
                    created_at=sale.created_at.isoformat(),
                )
                for sale in sales[:8]
            ],
            recent_orders=[
                RecentOrder(
                    id=order.id,
                    order_number=order.order_number,
                    source=order.source.value,
                    status=order.status.value,
                    total=order.total,
                    created_at=order.created_at.isoformat(),
                )
                for order in orders[:6]
            ],
            courier_success_rate=_rate(delivered, len(terminal)),
        )

    @staticmethod
    def window(start: date, end: date) -> tuple[datetime, datetime]:
        """UTC bounds for an inclusive range of Dhaka calendar days."""
        if end < start:
            raise AppError("INVALID_DATE_RANGE", "End date is before start date", status_code=422)
        if (end - start).days >= MAX_REPORT_DAYS:
            raise AppError("INVALID_DATE_RANGE", "Reports cover at most 366 days", status_code=422)
        return business_day_start(start), business_day_start(end + timedelta(days=1))

    async def _sales(self, since: datetime, until: datetime) -> list[Sale]:
        return list(
            await self.session.scalars(
                select(Sale)
                .where(
                    Sale.organization_id == self.user.organization_id,
                    Sale.branch_id == self.user.branch_id,
                    Sale.created_at >= since,
                    Sale.created_at < until,
                )
                .order_by(Sale.created_at)
            )
        )

    async def summary(self, start: date, end: date) -> SummaryReport:
        since, until = self.window(start, end)
        sales = await self._sales(since, until)
        refund_rows = await self._refund_rows(since, until)
        revenue = sum((sale.total for sale in sales), Decimal("0.00"))
        sold_cost = sum(
            (item.unit_cost * item.quantity for sale in sales for item in sale.items),
            Decimal("0.00"),
        )
        refunds = sum(
            (
                _paid_line_value(sale, sale_item, returned.quantity)
                for _, returned, sale, sale_item in refund_rows
            ),
            Decimal("0.00"),
        )
        restocked_cost = sum(
            (
                sale_item.unit_cost * returned.quantity
                for _, returned, _, sale_item in refund_rows
                if returned.disposition == "SELLABLE"
            ),
            Decimal("0.00"),
        )
        net_revenue = revenue - refunds
        cost_of_goods_sold = sold_cost - restocked_cost
        by_method: defaultdict[str, Decimal] = defaultdict(Decimal)
        for sale in sales:
            if sale.payments:
                for payment in sale.payments:
                    by_method[payment.method.value] += payment.amount
            else:
                by_method[PaymentMethod.CASH.value] += sale.total
        average = (revenue / len(sales)).quantize(Decimal("0.01")) if sales else Decimal("0.00")
        return SummaryReport(
            start=start,
            end=end,
            sales=SalesSummary(
                transactions=len(sales),
                revenue=revenue,
                refunds=refunds,
                net_revenue=net_revenue,
                discount=sum((sale.discount for sale in sales), Decimal("0.00")),
                cost_of_goods_sold=cost_of_goods_sold,
                gross_profit=net_revenue - cost_of_goods_sold,
                average_sale=average,
                offline_synced=sum(1 for sale in sales if sale.synced_offline),
                by_payment_method=dict(by_method),
            ),
            top_products=await self._product_performance(sales, refund_rows),
            inventory=await self._inventory(),
            cod=await self._orders(since, until),
            courier=await self._courier(since, until),
        )

    async def _refund_rows(
        self, since: datetime, until: datetime
    ) -> list[tuple[ReturnRecord, ReturnItem, Sale, SaleItem]]:
        """POS returns received in this Dhaka date range, joined to immutable sale snapshots."""
        rows = await self.session.execute(
            select(ReturnRecord, ReturnItem, Sale, SaleItem)
            .join(ReturnItem, ReturnItem.return_id == ReturnRecord.id)
            .join(Sale, Sale.id == ReturnRecord.sale_id)
            .join(
                SaleItem,
                and_(
                    SaleItem.sale_id == Sale.id,
                    SaleItem.variant_id == ReturnItem.variant_id,
                ),
            )
            .where(
                ReturnRecord.organization_id == self.user.organization_id,
                ReturnRecord.branch_id == self.user.branch_id,
                ReturnRecord.sale_id.is_not(None),
                ReturnRecord.created_at >= since,
                ReturnRecord.created_at < until,
            )
        )
        return [tuple(row) for row in rows.all()]  # type: ignore[misc]

    async def _product_performance(
        self,
        sales: list[Sale],
        refund_rows: list[tuple[ReturnRecord, ReturnItem, Sale, SaleItem]],
        limit: int | None = 10,
    ) -> list[ProductPerformance]:
        products: dict[str, ProductPerformance] = {}

        def row_for(item: SaleItem) -> ProductPerformance:
            return products.setdefault(
                item.sku,
                ProductPerformance(
                    product_name=item.product_name,
                    variant_name=item.variant_name,
                    sku=item.sku,
                    quantity=0,
                    returned_quantity=0,
                    net_quantity=0,
                    revenue=Decimal("0.00"),
                    cost=Decimal("0.00"),
                    gross_profit=Decimal("0.00"),
                    margin=None,
                ),
            )

        for sale in sales:
            for item in sale.items:
                row = row_for(item)
                row.quantity += item.quantity
                row.net_quantity += item.quantity
                row.revenue += _paid_line_value(sale, item, item.quantity)
                row.cost += item.unit_cost * item.quantity
        for _, returned, sale, item in refund_rows:
            row = row_for(item)
            row.returned_quantity += returned.quantity
            row.net_quantity -= returned.quantity
            row.revenue -= _paid_line_value(sale, item, returned.quantity)
            if returned.disposition == "SELLABLE":
                row.cost -= item.unit_cost * returned.quantity
        for row in products.values():
            row.gross_profit = row.revenue - row.cost
            row.margin = round(float(row.gross_profit / row.revenue), 4) if row.revenue else None
        ranked = sorted(products.values(), key=lambda row: row.revenue, reverse=True)
        return ranked[:limit] if limit is not None else ranked

    async def _inventory(self) -> InventorySummary:
        """Current snapshot; stock levels are not date-ranged."""
        result = await self.session.execute(
            select(InventoryBalance, ProductVariant)
            .join(ProductVariant, ProductVariant.id == InventoryBalance.variant_id)
            .where(
                InventoryBalance.organization_id == self.user.organization_id,
                InventoryBalance.branch_id == self.user.branch_id,
                ProductVariant.is_active.is_(True),
            )
        )
        rows = list(result.all())
        return InventorySummary(
            units_on_hand=sum(max(0, balance.physical_quantity) for balance, _ in rows),
            units_reserved=sum(balance.reserved_quantity for balance, _ in rows),
            units_available=sum(max(0, balance.available_quantity) for balance, _ in rows),
            cost_value=sum(
                (variant.cost * max(0, balance.physical_quantity) for balance, variant in rows),
                Decimal("0.00"),
            ),
            retail_value=sum(
                (variant.price * max(0, balance.physical_quantity) for balance, variant in rows),
                Decimal("0.00"),
            ),
            low_stock=sum(
                1
                for balance, variant in rows
                if 0 < balance.available_quantity <= variant.reorder_level
            ),
            out_of_stock=sum(1 for balance, _ in rows if balance.available_quantity <= 0),
        )

    async def _orders(self, since: datetime, until: datetime) -> OutcomeSummary:
        orders = list(
            await self.session.scalars(
                select(Order).where(
                    Order.organization_id == self.user.organization_id,
                    Order.branch_id == self.user.branch_id,
                    Order.created_at >= since,
                    Order.created_at < until,
                )
            )
        )
        delivered = sum(1 for order in orders if order.status == OrderStatus.DELIVERED)
        returned = sum(1 for order in orders if order.status in RETURNED_STATUSES)
        terminal = {OrderStatus.DELIVERED, OrderStatus.CANCELLED, *RETURNED_STATUSES}
        collected = sum(
            (order.total for order in orders if order.status == OrderStatus.DELIVERED),
            Decimal("0.00"),
        )
        failed = sum(
            (order.total for order in orders if order.status in RETURNED_STATUSES),
            Decimal("0.00"),
        )
        return OutcomeSummary(
            total=len(orders),
            value=sum((order.total for order in orders), Decimal("0.00")),
            by_status=dict(Counter(order.status.value for order in orders)),
            by_risk=dict(Counter(order.cod_risk_level for order in orders)),
            delivered=delivered,
            returned=returned,
            collected=collected,
            pending=sum(
                (order.total for order in orders if order.status not in terminal), Decimal("0.00")
            ),
            failed=failed,
            # No courier-expense model exists yet; this is failed COD value, not accounting loss.
            return_loss=failed,
            delivery_rate=_rate(delivered, delivered + returned),
        )

    async def _courier(self, since: datetime, until: datetime) -> CourierSummary:
        result = await self.session.execute(
            select(Shipment, Order.status)
            .join(Order, Shipment.order_id == Order.id)
            .where(
                Shipment.organization_id == self.user.organization_id,
                Order.branch_id == self.user.branch_id,
                Shipment.created_at >= since,
                Shipment.created_at < until,
            )
        )
        rows = list(result.all())
        delivered = sum(1 for _, status in rows if status == OrderStatus.DELIVERED)
        returned = sum(1 for _, status in rows if status in RETURNED_STATUSES)
        return CourierSummary(
            shipments=len(rows),
            delivered=delivered,
            returned=returned,
            in_transit=sum(1 for _, status in rows if status in IN_TRANSIT_STATUSES),
            failed=sum(1 for shipment, _ in rows if shipment.status == "CANCELLED"),
            by_provider=dict(Counter(shipment.provider for shipment, _ in rows)),
            by_status=dict(Counter(shipment.status for shipment, _ in rows)),
            delivery_rate=_rate(delivered, delivered + returned),
        )

    async def sales_csv(self, start: date, end: date) -> str:
        since, until = self.window(start, end)
        refund_rows = await self._refund_rows(since, until)
        refunds_by_sale: defaultdict[uuid.UUID, Decimal] = defaultdict(Decimal)
        for _, returned, sale, item in refund_rows:
            refunds_by_sale[sale.id] += _paid_line_value(sale, item, returned.quantity)
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(
            [
                "invoice_number",
                "created_at_dhaka",
                "items",
                "subtotal",
                "discount",
                "total",
                "refunds_in_range",
                "net_total",
                "payment_method",
                "synced_offline",
            ]
        )
        for sale in await self._sales(since, until):
            refund = refunds_by_sale[sale.id]
            writer.writerow(
                [
                    sale.invoice_number,
                    as_utc(sale.created_at).astimezone(BUSINESS_TZ).isoformat(timespec="seconds"),
                    sum(item.quantity for item in sale.items),
                    sale.subtotal,
                    sale.discount,
                    sale.total,
                    refund,
                    sale.total - refund,
                    sale.payments[0].method.value if sale.payments else "",
                    "yes" if sale.synced_offline else "no",
                ]
            )
        return buffer.getvalue()

    async def products_csv(self, start: date, end: date) -> str:
        since, until = self.window(start, end)
        products = await self._product_performance(
            await self._sales(since, until), await self._refund_rows(since, until), limit=None
        )
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(
            [
                "sku",
                "product",
                "variant",
                "units_sold",
                "units_returned",
                "net_units",
                "net_revenue",
                "cost_of_goods_sold",
                "gross_profit",
                "margin",
            ]
        )
        for row in products:
            writer.writerow(
                [
                    row.sku,
                    row.product_name,
                    row.variant_name,
                    row.quantity,
                    row.returned_quantity,
                    row.net_quantity,
                    row.revenue,
                    row.cost,
                    row.gross_profit,
                    row.margin if row.margin is not None else "",
                ]
            )
        return buffer.getvalue()
