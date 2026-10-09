"""The POS's downloadable catalog (plan §40): a version to compare, a full snapshot, and stock."""

import hashlib
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Category, InventoryBalance, Product, ProductVariant, User
from app.schemas.catalog import (
    CatalogCategory,
    CatalogItem,
    CatalogSnapshot,
    CatalogVersion,
    StockSnapshot,
)

MAX_CATALOG_ITEMS = 10_000


class CatalogService:
    def __init__(self, session: AsyncSession, user: User) -> None:
        self.session = session
        self.user = user

    async def version(self) -> CatalogVersion:
        """Changes whenever a product, variant or category is added, edited or deactivated.
        Stock levels are deliberately excluded; they travel in the stock snapshot."""
        org = self.user.organization_id
        variants = (
            await self.session.execute(
                select(func.count(ProductVariant.id), func.max(ProductVariant.updated_at)).where(
                    ProductVariant.organization_id == org
                )
            )
        ).one()
        products = await self.session.scalar(
            select(func.max(Product.updated_at)).where(Product.organization_id == org)
        )
        categories = (
            await self.session.execute(
                select(func.count(Category.id), func.max(Category.updated_at)).where(
                    Category.organization_id == org
                )
            )
        ).one()
        fingerprint = "|".join(
            str(part)
            for part in (org, variants[0], variants[1], products, categories[0], categories[1])
        )
        return CatalogVersion(
            version=hashlib.sha256(fingerprint.encode()).hexdigest()[:16], variant_count=variants[0]
        )

    async def snapshot(self) -> CatalogSnapshot:
        version = await self.version()
        stock = await self._stock()
        rows = await self.session.execute(
            select(ProductVariant, Product, Category.name)
            .join(Product, Product.id == ProductVariant.product_id)
            .outerjoin(Category, Category.id == Product.category_id)
            .where(
                ProductVariant.organization_id == self.user.organization_id,
                ProductVariant.is_active.is_(True),
                Product.is_active.is_(True),
            )
            .order_by(Product.name, ProductVariant.name)
            .limit(MAX_CATALOG_ITEMS)
        )
        items = [
            CatalogItem(
                variant_id=variant.id,
                product_id=product.id,
                product_name=product.name,
                variant_name=variant.name,
                sku=variant.sku,
                barcode=variant.barcode,
                price=variant.price,
                category_id=product.category_id,
                category_name=category_name,
                image_url=product.image_url,
                attributes=variant.attributes,
                reorder_level=variant.reorder_level,
                available_quantity=stock.get(str(variant.id), 0),
            )
            for variant, product, category_name in rows.all()
        ]
        categories = await self.session.execute(
            select(Category.id, Category.name)
            .where(Category.organization_id == self.user.organization_id)
            .order_by(Category.name)
        )
        return CatalogSnapshot(
            version=version.version,
            generated_at=datetime.now(UTC),
            categories=[CatalogCategory(id=row.id, name=row.name) for row in categories.all()],
            items=items,
        )

    async def stock(self) -> StockSnapshot:
        return StockSnapshot(as_of=datetime.now(UTC), available=await self._stock())

    async def _stock(self) -> dict[str, int]:
        rows = await self.session.execute(
            select(
                InventoryBalance.variant_id,
                InventoryBalance.physical_quantity - InventoryBalance.reserved_quantity,
            ).where(
                InventoryBalance.organization_id == self.user.organization_id,
                InventoryBalance.branch_id == self.user.branch_id,
            )
        )
        return {str(variant_id): int(available) for variant_id, available in rows.all()}
