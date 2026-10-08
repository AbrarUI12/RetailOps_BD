import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class InventoryAdjustment(BaseModel):
    variant_id: uuid.UUID
    quantity_delta: int
    reason: str = Field(min_length=3, max_length=80)
    note: str = Field(min_length=3, max_length=500)

    @field_validator("quantity_delta")
    @classmethod
    def quantity_must_be_non_zero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("Quantity adjustment cannot be zero")
        return value


class InventoryView(BaseModel):
    variant_id: uuid.UUID
    product_name: str
    variant_name: str
    sku: str
    barcode: str | None
    physical_quantity: int
    reserved_quantity: int
    available_quantity: int
    reorder_level: int
    stock_status: str


class MovementView(BaseModel):
    id: uuid.UUID
    variant_id: uuid.UUID
    movement_type: str
    quantity_delta: int
    previous_quantity: int
    new_quantity: int
    note: str | None
    created_at: datetime
