import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.entities import OrderSource, OrderStatus
from app.services.couriers import CourierStatus


class AddressInput(BaseModel):
    label: str = "Home"
    address: str = Field(min_length=5, max_length=500)
    area: str | None = Field(default=None, max_length=100)
    city: str = Field(default="Dhaka", max_length=80)


class CustomerCreate(BaseModel):
    name: str = Field(min_length=2, max_length=140)
    phone: str
    phone_verified: bool = False
    notes: str | None = Field(default=None, max_length=1000)
    address: AddressInput | None = None


class CustomerView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    phone: str
    normalized_phone: str
    phone_verified: bool
    notes: str | None
    created_at: datetime


class OrderLineInput(BaseModel):
    variant_id: uuid.UUID
    quantity: int = Field(gt=0, le=999)


class OrderCreate(BaseModel):
    customer_id: uuid.UUID | None = None
    customer: CustomerCreate | None = None
    source: OrderSource = OrderSource.FACEBOOK
    delivery_address: str = Field(min_length=5, max_length=500)
    area: str | None = Field(default=None, max_length=100)
    delivery_fee: Decimal = Field(default=Decimal("0"), ge=0)
    discount: Decimal = Field(default=Decimal("0"), ge=0)
    items: list[OrderLineInput] = Field(min_length=1)


class OrderItemView(BaseModel):
    variant_id: uuid.UUID
    product_name: str
    quantity: int
    unit_price: Decimal
    line_total: Decimal


class RiskView(BaseModel):
    score: int
    level: str
    reasons: list[str]
    recommendation: str


class OrderView(BaseModel):
    id: uuid.UUID
    order_number: str
    customer_id: uuid.UUID
    source: OrderSource
    status: OrderStatus
    delivery_address: str
    area: str | None
    subtotal: Decimal
    delivery_fee: Decimal
    discount: Decimal
    total: Decimal
    risk: RiskView
    items: list[OrderItemView]
    created_at: datetime


class TransitionInput(BaseModel):
    status: OrderStatus
    note: str | None = Field(default=None, max_length=500)


class ShipmentEventView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    status: str
    description: str
    occurred_at: datetime


class ShipmentView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    order_id: uuid.UUID
    provider: str
    tracking_code: str
    status: str
    created_at: datetime
    order_status: OrderStatus | None = None
    events: list[ShipmentEventView] = []


class CourierUpdateInput(BaseModel):
    status: CourierStatus
    description: str | None = Field(default=None, max_length=240)


class ReturnLineInput(BaseModel):
    variant_id: uuid.UUID
    quantity: int = Field(gt=0)
    disposition: str = Field(pattern="^(SELLABLE|DAMAGED|MISSING)$")


class ReturnCreate(BaseModel):
    order_id: uuid.UUID | None = None
    sale_id: uuid.UUID | None = None
    reason: str = Field(min_length=3, max_length=200)
    items: list[ReturnLineInput] = Field(min_length=1)


class SyncSaleInput(BaseModel):
    client_transaction_id: uuid.UUID
    payload: dict[str, object]
    device_key: str = Field(default="browser-pos", max_length=80)


class SyncResult(BaseModel):
    client_transaction_id: uuid.UUID
    status: str
    server_record_id: uuid.UUID | None
    idempotent_replay: bool = False
    conflict: bool = False
    message: str | None = None


class SupplierCreate(BaseModel):
    name: str = Field(min_length=2, max_length=140)
    phone: str | None = None
    email: str | None = None


class SupplierView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    phone: str | None
    email: str | None


class PurchaseLineInput(BaseModel):
    variant_id: uuid.UUID
    quantity: int = Field(gt=0)
    unit_cost: Decimal = Field(gt=0)


class PurchaseCreate(BaseModel):
    supplier_id: uuid.UUID
    reference: str = Field(min_length=2, max_length=60)
    items: list[PurchaseLineInput] = Field(min_length=1)


class PurchaseView(BaseModel):
    id: uuid.UUID
    reference: str
    supplier_id: uuid.UUID
    status: str
    total: Decimal
    created_at: datetime


class NotificationView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    kind: str
    title: str
    message: str
    read_at: datetime | None
    entity_type: str | None
    entity_id: uuid.UUID | None
    created_at: datetime


class AuditView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    action: str
    entity_type: str
    entity_id: uuid.UUID | None
    user_id: uuid.UUID | None
    old_data: dict[str, object] | None
    new_data: dict[str, object] | None
    created_at: datetime
