import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field, model_validator

from app.models.entities import PaymentMethod


class SaleLineRequest(BaseModel):
    variant_id: uuid.UUID
    quantity: int = Field(gt=0, le=999)


class CreateSaleRequest(BaseModel):
    items: list[SaleLineRequest] = Field(min_length=1)
    payment_method: PaymentMethod
    amount_received: Decimal = Field(ge=0, decimal_places=2)
    discount: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=2)
    customer_id: uuid.UUID | None = None
    client_transaction_id: uuid.UUID | None = None
    allow_inventory_conflict: bool = False

    @model_validator(mode="after")
    def unique_variants(self) -> "CreateSaleRequest":
        ids = [item.variant_id for item in self.items]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate variants must be combined into one line")
        return self


class SaleLineView(BaseModel):
    variant_id: uuid.UUID
    product_name: str
    variant_name: str
    sku: str
    quantity: int
    unit_price: Decimal
    line_total: Decimal


class SaleView(BaseModel):
    id: uuid.UUID
    invoice_number: str
    subtotal: Decimal
    discount: Decimal
    total: Decimal
    payment_method: PaymentMethod
    amount_received: Decimal
    change_due: Decimal
    created_at: datetime
    items: list[SaleLineView]
    idempotent_replay: bool = False
    inventory_conflict: bool = False
