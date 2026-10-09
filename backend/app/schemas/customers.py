import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.operations import AddressInput, CustomerView, RiskView


class CustomerAddressView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    label: str
    address: str
    area: str | None
    city: str
    created_at: datetime


class CustomerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=140)
    phone: str | None = Field(default=None, min_length=8, max_length=32)
    phone_verified: bool | None = None
    notes: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def required_fields_cannot_be_cleared(self) -> "CustomerUpdate":
        for field in ("name", "phone", "phone_verified"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class CustomerMetrics(BaseModel):
    total_spend: Decimal
    sale_count: int
    order_count: int
    successful_deliveries: int
    delivery_outcomes: int
    delivery_success_rate: float | None
    cod_risk: RiskView


class CustomerPurchaseView(BaseModel):
    id: uuid.UUID
    kind: str
    reference: str
    status: str
    source: str
    total: Decimal
    created_at: datetime


class CustomerPaymentView(BaseModel):
    id: uuid.UUID
    reference: str
    method: str
    amount: Decimal
    created_at: datetime


class CustomerReturnView(BaseModel):
    id: uuid.UUID
    reference: str
    status: str
    reason: str
    created_at: datetime


class CustomerActivityView(BaseModel):
    id: str
    kind: str
    title: str
    detail: str | None
    created_at: datetime


class CustomerProfile(BaseModel):
    customer: CustomerView
    metrics: CustomerMetrics
    addresses: list[CustomerAddressView]
    purchases: list[CustomerPurchaseView]
    payments: list[CustomerPaymentView]
    returns: list[CustomerReturnView]
    activity: list[CustomerActivityView]


CustomerAddressCreate = AddressInput
