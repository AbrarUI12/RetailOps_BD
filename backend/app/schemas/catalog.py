import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel


class CatalogVersion(BaseModel):
    version: str
    variant_count: int


class CatalogCategory(BaseModel):
    id: uuid.UUID
    name: str


class CatalogItem(BaseModel):
    """One sellable variant, flattened for the POS's local search (plan §40)."""

    variant_id: uuid.UUID
    product_id: uuid.UUID
    product_name: str
    variant_name: str
    sku: str
    barcode: str | None
    price: Decimal
    category_id: uuid.UUID | None
    category_name: str | None
    image_url: str | None
    attributes: dict[str, str]
    reorder_level: int
    available_quantity: int


class CatalogSnapshot(BaseModel):
    version: str
    generated_at: datetime
    categories: list[CatalogCategory]
    items: list[CatalogItem]


class StockSnapshot(BaseModel):
    """Available stock per variant at the branch; refreshed more often than the catalog."""

    as_of: datetime
    available: dict[str, int]
