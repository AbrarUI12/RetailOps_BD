import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

AdjustmentReason = Literal[
    "COUNT_CORRECTION",
    "DAMAGED",
    "LOST_OR_STOLEN",
    "FOUND",
    "OPENING_STOCK",
    "RETURNED_TO_SUPPLIER",
    "OTHER",
]

REASON_LABELS: dict[str, str] = {
    "COUNT_CORRECTION": "Physical count correction",
    "DAMAGED": "Damaged",
    "LOST_OR_STOLEN": "Lost or stolen",
    "FOUND": "Found stock",
    "OPENING_STOCK": "Opening stock",
    "RETURNED_TO_SUPPLIER": "Returned to supplier",
    "OTHER": "Other",
}


class InventoryAdjustment(BaseModel):
    """Exactly one of quantity_delta ("+8") or counted_quantity ("we counted 20"). Every
    adjustment carries a reason and a note: no unexplained inventory edits (plan §18)."""

    variant_id: uuid.UUID
    quantity_delta: int | None = None
    counted_quantity: int | None = Field(default=None, ge=0)
    reason: AdjustmentReason
    note: str = Field(min_length=3, max_length=500)

    @model_validator(mode="after")
    def one_quantity(self) -> "InventoryAdjustment":
        if (self.quantity_delta is None) == (self.counted_quantity is None):
            raise ValueError("Give either the change in quantity or the new counted quantity")
        if self.quantity_delta == 0:
            raise ValueError("Quantity adjustment cannot be zero")
        return self


class InventoryView(BaseModel):
    variant_id: uuid.UUID
    product_id: uuid.UUID
    product_name: str
    variant_name: str
    category_name: str | None = None
    sku: str
    barcode: str | None
    physical_quantity: int
    reserved_quantity: int
    available_quantity: int
    reorder_level: int
    stock_status: str


class InventoryPage(BaseModel):
    items: list[InventoryView]
    page: int
    page_size: int
    total: int


class MovementView(BaseModel):
    id: uuid.UUID
    variant_id: uuid.UUID
    movement_type: str
    quantity_delta: int
    previous_quantity: int
    new_quantity: int
    note: str | None
    reference_type: str | None = None
    reference_id: uuid.UUID | None = None
    created_by_name: str | None = None
    created_at: datetime


class InventoryDetail(BaseModel):
    item: InventoryView
    movements: list[MovementView]
