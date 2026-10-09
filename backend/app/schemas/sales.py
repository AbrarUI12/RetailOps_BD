import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field, model_validator

from app.models.entities import PaymentMethod

TENDER_METHODS = {PaymentMethod.CASH, PaymentMethod.BKASH, PaymentMethod.NAGAD, PaymentMethod.CARD}


class SaleLineRequest(BaseModel):
    variant_id: uuid.UUID
    quantity: int = Field(gt=0, le=999)


class PaymentLine(BaseModel):
    method: PaymentMethod
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)


class CreateSaleRequest(BaseModel):
    items: list[SaleLineRequest] = Field(min_length=1, max_length=100)
    payment_method: PaymentMethod
    amount_received: Decimal = Field(ge=0, max_digits=14, decimal_places=2)
    # Required for SPLIT: the tender lines, e.g. part bKash and part cash.
    payments: list[PaymentLine] | None = Field(default=None, max_length=4)
    discount: Decimal = Field(default=Decimal("0"), ge=0, max_digits=14, decimal_places=2)
    customer_id: uuid.UUID | None = None
    client_transaction_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def validate_lines(self) -> "CreateSaleRequest":
        ids = [item.variant_id for item in self.items]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate variants must be combined into one line")
        if self.payment_method == PaymentMethod.COD:
            raise ValueError("COD is for delivery orders, not POS sales")
        if self.payment_method == PaymentMethod.SPLIT:
            if not self.payments or len(self.payments) < 2:
                raise ValueError("A split payment needs at least two payment lines")
            if any(line.method not in TENDER_METHODS for line in self.payments):
                raise ValueError("Split payment lines must be cash, bKash, Nagad or card")
        return self


class OfflineSaleLine(SaleLineRequest):
    # The price the customer actually paid on the device; absent in queues from older clients.
    unit_price: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)


class OfflineSalePayload(CreateSaleRequest):
    """A sale completed on a device while offline. Its facts are kept as they happened."""

    items: list[OfflineSaleLine] = Field(min_length=1, max_length=100)  # type: ignore[assignment]
    offline_created_at: datetime | None = None


class SaleLineView(BaseModel):
    variant_id: uuid.UUID
    product_name: str
    variant_name: str
    sku: str
    quantity: int
    unit_price: Decimal
    line_total: Decimal
    returned_quantity: int = 0


class PaymentView(BaseModel):
    method: PaymentMethod
    amount: Decimal


class SaleView(BaseModel):
    id: uuid.UUID
    invoice_number: str
    subtotal: Decimal
    discount: Decimal
    total: Decimal
    payment_method: PaymentMethod
    payments: list[PaymentView]
    amount_received: Decimal
    change_due: Decimal
    created_at: datetime
    cashier_name: str | None = None
    customer_name: str | None = None
    synced_offline: bool = False
    items: list[SaleLineView]
    idempotent_replay: bool = False
    inventory_conflict: bool = False
    price_mismatch: bool = False


class SaleListItem(BaseModel):
    id: uuid.UUID
    invoice_number: str
    customer_name: str | None = None
    cashier_name: str
    item_count: int
    total: Decimal
    payment_method: PaymentMethod
    returned_quantity: int = 0
    synced_offline: bool
    created_at: datetime


class SalePage(BaseModel):
    items: list[SaleListItem]
    total: int
    page: int
    page_size: int


class RefundSaleLine(BaseModel):
    variant_id: uuid.UUID
    quantity: int = Field(gt=0, le=999)
    disposition: str = Field(default="SELLABLE", pattern="^(SELLABLE|DAMAGED|MISSING)$")


class RefundSaleRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=200)
    items: list[RefundSaleLine] = Field(min_length=1, max_length=100)
