import csv
import io
import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
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
    Sale,
    Shipment,
    User,
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


def _rate(part: int, whole: int) -> float | None:
    return round(part / whole, 4) if whole else None


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
        revenue = sum((sale.total for sale in sales), Decimal("0.00"))
        cost = sum(
            (item.unit_cost * item.quantity for sale in sales for item in sale.items),
            Decimal("0.00"),
        )
        by_method: defaultdict[str, Decimal] = defaultdict(Decimal)
        products: dict[str, ProductPerformance] = {}
        for sale in sales:
            method = sale.payments[0].method if sale.payments else PaymentMethod.CASH
            by_method[method.value] += sale.total
            for item in sale.items:
                row = products.setdefault(
                    item.sku,
                    ProductPerformance(
                        product_name=item.product_name,
                        variant_name=item.variant_name,
                        sku=item.sku,
                        quantity=0,
                        revenue=Decimal("0.00"),
                        gross_profit=Decimal("0.00"),
                    ),
                )
                row.quantity += item.quantity
                row.revenue += item.line_total
                row.gross_profit += item.line_total - item.unit_cost * item.quantity
        average = (revenue / len(sales)).quantize(Decimal("0.01")) if sales else Decimal("0.00")
        return SummaryReport(
            start=start,
            end=end,
            sales=SalesSummary(
                transactions=len(sales),
                revenue=revenue,
                discount=sum((sale.discount for sale in sales), Decimal("0.00")),
                gross_profit=revenue - cost,
                average_sale=average,
                offline_synced=sum(1 for sale in sales if sale.synced_offline),
                by_payment_method=dict(by_method),
            ),
            top_products=sorted(products.values(), key=lambda row: row.revenue, reverse=True)[:10],
            inventory=await self._inventory(),
            cod=await self._orders(since, until),
            courier=await self._courier(since, until),
        )

    async def _inventory(self) -> InventorySummary:
        """Current snapshot; stock levels are not date-ranged."""
        rows = (
            (
                await self.session.execute(
                    select(InventoryBalance, ProductVariant)
                    .join(ProductVariant, ProductVariant.id == InventoryBalance.variant_id)
                    .where(
                        InventoryBalance.organization_id == self.user.organization_id,
                        InventoryBalance.branch_id == self.user.branch_id,
                        ProductVariant.is_active.is_(True),
                    )
                )
            )
            .tuples()
            .all()
        )
        return InventorySummary(
            units_on_hand=sum(max(0, balance.physical_quantity) for balance, _ in rows),
            units_reserved=sum(balance.reserved_quantity for balance, _ in rows),
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
        return OutcomeSummary(
            total=len(orders),
            value=sum((order.total for order in orders), Decimal("0.00")),
            by_status=dict(Counter(order.status.value for order in orders)),
            by_risk=dict(Counter(order.cod_risk_level for order in orders)),
            delivered=delivered,
            returned=returned,
            delivery_rate=_rate(delivered, delivered + returned),
        )

    async def _courier(self, since: datetime, until: datetime) -> CourierSummary:
        statuses = list(
            await self.session.scalars(
                select(Order.status)
                .join(Shipment, Shipment.order_id == Order.id)
                .where(
                    Shipment.organization_id == self.user.organization_id,
                    Order.branch_id == self.user.branch_id,
                    Shipment.created_at >= since,
                    Shipment.created_at < until,
                )
            )
        )
        delivered = sum(1 for status in statuses if status == OrderStatus.DELIVERED)
        returned = sum(1 for status in statuses if status in RETURNED_STATUSES)
        return CourierSummary(
            shipments=len(statuses),
            delivered=delivered,
            returned=returned,
            in_transit=sum(1 for status in statuses if status in IN_TRANSIT_STATUSES),
            delivery_rate=_rate(delivered, delivered + returned),
        )

    async def sales_csv(self, start: date, end: date) -> str:
        since, until = self.window(start, end)
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
                "payment_method",
                "synced_offline",
            ]
        )
        for sale in await self._sales(since, until):
            writer.writerow(
                [
                    sale.invoice_number,
                    as_utc(sale.created_at).astimezone(BUSINESS_TZ).isoformat(timespec="seconds"),
                    sum(item.quantity for item in sale.items),
                    sale.subtotal,
                    sale.discount,
                    sale.total,
                    sale.payments[0].method.value if sale.payments else "",
                    "yes" if sale.synced_offline else "no",
                ]
            )
        return buffer.getvalue()
