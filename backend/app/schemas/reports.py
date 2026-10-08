from datetime import date
from decimal import Decimal

from pydantic import BaseModel


class DashboardKpis(BaseModel):
    revenue: Decimal
    orders: int
    gross_profit: Decimal
    average_order_value: Decimal
    low_stock: int


class RevenuePoint(BaseModel):
    label: str
    revenue: Decimal


class RecentSale(BaseModel):
    invoice_number: str
    total: Decimal
    created_at: str


class DashboardReport(BaseModel):
    kpis: DashboardKpis
    revenue_series: list[RevenuePoint]
    recent_sales: list[RecentSale]


class SalesSummary(BaseModel):
    transactions: int
    revenue: Decimal
    discount: Decimal
    gross_profit: Decimal
    average_sale: Decimal
    offline_synced: int
    by_payment_method: dict[str, Decimal]


class ProductPerformance(BaseModel):
    product_name: str
    variant_name: str
    sku: str
    quantity: int
    revenue: Decimal
    gross_profit: Decimal


class InventorySummary(BaseModel):
    units_on_hand: int
    units_reserved: int
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
    delivery_rate: float | None


class CourierSummary(BaseModel):
    shipments: int
    delivered: int
    returned: int
    in_transit: int
    delivery_rate: float | None


class SummaryReport(BaseModel):
    start: date
    end: date
    sales: SalesSummary
    top_products: list[ProductPerformance]
    inventory: InventorySummary
    cod: OutcomeSummary
    courier: CourierSummary
