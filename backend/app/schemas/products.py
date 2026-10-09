import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator


class CategoryCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100)


class CategoryUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=100)


class CategoryView(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    product_count: int = 0


class VariantCreate(BaseModel):
    name: str = Field(min_length=1, max_length=140)
    sku: str = Field(min_length=1, max_length=64)
    barcode: str | None = Field(default=None, max_length=80)
    price: Decimal = Field(gt=0, decimal_places=2)
    cost: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=2)
    attributes: dict[str, str] = Field(default_factory=dict)
    reorder_level: int = Field(default=5, ge=0)


class VariantUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=140)
    sku: str | None = Field(default=None, min_length=1, max_length=64)
    barcode: str | None = Field(default=None, max_length=80)
    price: Decimal | None = Field(default=None, gt=0, decimal_places=2)
    cost: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    attributes: dict[str, str] | None = None
    reorder_level: int | None = Field(default=None, ge=0)
    is_active: bool | None = None


class ProductCreate(BaseModel):
    name: str = Field(min_length=2, max_length=180)
    sku: str = Field(min_length=1, max_length=64)
    category_id: uuid.UUID | None = None
    description: str | None = Field(default=None, max_length=2000)
    image_url: HttpUrl | None = None
    variants: list[VariantCreate] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def unique_identifiers(self) -> "ProductCreate":
        skus = [variant.sku.strip().upper() for variant in self.variants]
        barcodes = [variant.barcode.strip() for variant in self.variants if variant.barcode]
        if len(skus) != len(set(skus)):
            raise ValueError("Each variant needs its own SKU")
        if len(barcodes) != len(set(barcodes)):
            raise ValueError("Each variant needs its own barcode")
        return self


class ProductUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=180)
    description: str | None = Field(default=None, max_length=2000)
    category_id: uuid.UUID | None = None
    image_url: HttpUrl | None = None
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
    # Sellable stock at the user's branch (physical minus reserved).
    available_quantity: int = 0


class ProductView(BaseModel):
    id: uuid.UUID
    name: str
    sku: str
    description: str | None
    category_id: uuid.UUID | None
    category_name: str | None = None
    image_url: str | None = None
    is_active: bool
    created_at: datetime
    variants: list[VariantView]


StockFilter = Literal["in_stock", "low", "out"]


class ProductPage(BaseModel):
    items: list[ProductView]
    page: int
    page_size: int
    total: int
