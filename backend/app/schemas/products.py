import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class VariantCreate(BaseModel):
    name: str = Field(min_length=1, max_length=140)
    sku: str = Field(min_length=1, max_length=64)
    barcode: str | None = Field(default=None, max_length=80)
    price: Decimal = Field(gt=0, decimal_places=2)
    cost: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=2)
    attributes: dict[str, str] = Field(default_factory=dict)
    reorder_level: int = Field(default=5, ge=0)


class ProductCreate(BaseModel):
    name: str = Field(min_length=2, max_length=180)
    sku: str = Field(min_length=1, max_length=64)
    category_id: uuid.UUID | None = None
    description: str | None = Field(default=None, max_length=2000)
    variants: list[VariantCreate] = Field(min_length=1)


class ProductUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=180)
    description: str | None = Field(default=None, max_length=2000)
    category_id: uuid.UUID | None = None
    is_active: bool | None = None


class VariantView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    product_id: uuid.UUID
    name: str
    sku: str
    barcode: str | None
    price: Decimal
    cost: Decimal
    attributes: dict[str, str]
    reorder_level: int
    is_active: bool


class ProductView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    sku: str
    description: str | None
    category_id: uuid.UUID | None
    is_active: bool
    created_at: datetime
    variants: list[VariantView]


class ProductPage(BaseModel):
    items: list[ProductView]
    page: int
    page_size: int
    total: int
