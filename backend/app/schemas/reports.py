import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel


class DashboardKpis(BaseModel):
    revenue: Decimal
    sales: int
    orders: int
    gross_profit: Decimal
    average_order_value: Decimal
    pending_orders: int
    low_stock: int


class RevenuePoint(BaseModel):
    label: str
    revenue: Decimal


class RecentSale(BaseModel):
    id: uuid.UUID
    invoice_number: str
    total: Decimal
    created_at: str


class DashboardBranch(BaseModel):
    id: uuid.UUID
    name: str


class LowStockItem(BaseModel):
    variant_id: uuid.UUID
    product_name: str
    variant_name: str
    sku: str
    available_quantity: int
    reorder_level: int


class RecentOrder(BaseModel):
    id: uuid.UUID
    order_number: str
    source: str
    status: str
    total: Decimal
    created_at: str


class DashboardProduct(BaseModel):
    product_name: str
    variant_name: str
    quantity: int
    revenue: Decimal


class DashboardReport(BaseModel):
    start: date
    end: date
    branch_id: uuid.UUID
    branches: list[DashboardBranch]
    kpis: DashboardKpis
    revenue_series: list[RevenuePoint]
    orders_by_source: dict[str, int]
    top_products: list[DashboardProduct]
    low_stock_items: list[LowStockItem]
    recent_sales: list[RecentSale]
    recent_orders: list[RecentOrder]
    courier_success_rate: float | None


class SalesSummary(BaseModel):
    transactions: int
    revenue: Decimal
    refunds: Decimal
    net_revenue: Decimal
    discount: Decimal
    cost_of_goods_sold: Decimal
    gross_profit: Decimal
    average_sale: Decimal
    offline_synced: int
    by_payment_method: dict[str, Decimal]


class ProductPerformance(BaseModel):
    product_name: str
    variant_name: str
    sku: str
    quantity: int
    returned_quantity: int
    net_quantity: int
    revenue: Decimal
    cost: Decimal
    gross_profit: Decimal
    margin: float | None


class InventorySummary(BaseModel):
    units_on_hand: int
    units_reserved: int
    units_available: int
    cost_value: Decimal
    retail_value: Decimal
    low_stock: int
    out_of_stock: int


class OutcomeSummary(BaseModel):
    total: int
    value: Decimal
    by_status: dict[str, int]
    by_risk: dict[str, int]
    delivered: int
    returned: int
    collected: Decimal
    pending: Decimal
    failed: Decimal
    return_loss: Decimal
    delivery_rate: float | None


class CourierSummary(BaseModel):
    shipments: int
    delivered: int
    returned: int
    in_transit: int
    failed: int
    by_provider: dict[str, int]
    by_status: dict[str, int]
    delivery_rate: float | None


class SummaryReport(BaseModel):
    start: date
    end: date
    sales: SalesSummary
    top_products: list[ProductPerformance]
    inventory: InventorySummary
    cod: OutcomeSummary
    courier: CourierSummary
