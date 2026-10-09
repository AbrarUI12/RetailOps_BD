import re
import uuid

from sqlalchemy import exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.models.entities import Category, InventoryBalance, Product, ProductVariant, User
from app.schemas.products import (
    CategoryCreate,
    CategoryUpdate,
    CategoryView,
    ProductCreate,
    ProductPage,
    ProductUpdate,
    ProductView,
    StockFilter,
    VariantCreate,
    VariantUpdate,
    VariantView,
)
from app.services.audit_service import add_audit


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:100] or "category"


class ProductService:
    def __init__(self, session: AsyncSession, user: User) -> None:
        self.session = session
        self.user = user

    # Categories -------------------------------------------------------------------------------

    async def categories(self) -> list[CategoryView]:
        rows = await self.session.execute(
            select(Category, func.count(Product.id))
            .outerjoin(Product, Product.category_id == Category.id)
            .where(Category.organization_id == self.user.organization_id)
            .group_by(Category.id)
            .order_by(Category.name)
        )
        return [
            CategoryView(
                id=category.id, name=category.name, slug=category.slug, product_count=count
            )
            for category, count in rows.all()
        ]

    async def create_category(self, command: CategoryCreate) -> CategoryView:
        name = command.name.strip()
        await self._ensure_category_name_free(name)
        category = Category(organization_id=self.user.organization_id, name=name, slug=_slug(name))
        self.session.add(category)
        await self.session.flush()
        add_audit(
            self.session,
            self.user,
            "category.created",
            "category",
            category.id,
            new_data={"name": name},
        )
        await self.session.commit()
        return CategoryView(id=category.id, name=category.name, slug=category.slug)

    async def update_category(
        self, category_id: uuid.UUID, command: CategoryUpdate
    ) -> CategoryView:
        category = await self._category(category_id)
        name = command.name.strip()
        if name.lower() != category.name.lower():
            await self._ensure_category_name_free(name)
        old = category.name
        category.name, category.slug = name, _slug(name)
        add_audit(
            self.session,
            self.user,
            "category.renamed",
            "category",
            category.id,
            old_data={"name": old},
            new_data={"name": name},
        )
        await self.session.commit()
        return next(item for item in await self.categories() if item.id == category.id)

    async def delete_category(self, category_id: uuid.UUID) -> None:
        category = await self._category(category_id)
        if await self.session.scalar(select(exists().where(Product.category_id == category.id))):
            raise AppError(
                "CATEGORY_IN_USE",
                "Move its products to another category before deleting it",
                status_code=409,
            )
        add_audit(
            self.session,
            self.user,
            "category.deleted",
            "category",
            category.id,
            old_data={"name": category.name},
        )
        await self.session.delete(category)
        await self.session.commit()

    async def _category(self, category_id: uuid.UUID) -> Category:
        category = await self.session.scalar(
            select(Category).where(
                Category.id == category_id, Category.organization_id == self.user.organization_id
            )
        )
        if category is None:
            raise AppError("CATEGORY_NOT_FOUND", "Category was not found", status_code=404)
        return category

    async def _ensure_category_name_free(self, name: str) -> None:
        if await self.session.scalar(
            select(Category.id).where(
                Category.organization_id == self.user.organization_id,
                func.lower(Category.name) == name.lower(),
            )
        ):
            raise AppError(
                "DUPLICATE_CATEGORY", f"A category named {name} already exists", status_code=409
            )

    async def _ensure_category(self, category_id: uuid.UUID | None) -> None:
        if category_id:
            await self._category(category_id)

    # Products ---------------------------------------------------------------------------------

    async def list_products(
        self,
        search: str | None,
        page: int,
        page_size: int,
        *,
        category_id: uuid.UUID | None = None,
        active: bool | None = None,
        stock: StockFilter | None = None,
    ) -> ProductPage:
        filters = [Product.organization_id == self.user.organization_id]
        if search and search.strip():
            term = f"%{search.strip()}%"
            matching_variant = exists().where(
                ProductVariant.product_id == Product.id,
                or_(
                    ProductVariant.sku.ilike(term),
                    ProductVariant.barcode == search.strip(),
                    ProductVariant.name.ilike(term),
                ),
            )
            filters.append(or_(Product.name.ilike(term), Product.sku.ilike(term), matching_variant))
        if category_id:
            filters.append(Product.category_id == category_id)
        if active is not None:
            filters.append(Product.is_active.is_(active))
        if stock:
            available = InventoryBalance.physical_quantity - InventoryBalance.reserved_quantity
            low_variant = (
                select(ProductVariant.product_id)
                .outerjoin(
                    InventoryBalance,
                    (InventoryBalance.variant_id == ProductVariant.id)
                    & (InventoryBalance.branch_id == self.user.branch_id),
                )
                .where(ProductVariant.is_active.is_(True))
            )
            if stock == "out":
                low_variant = low_variant.where(func.coalesce(available, 0) <= 0)
            elif stock == "low":
                low_variant = low_variant.where(
                    func.coalesce(available, 0) > 0,
                    func.coalesce(available, 0) <= ProductVariant.reorder_level,
                )
            else:
                low_variant = low_variant.where(
                    func.coalesce(available, 0) > ProductVariant.reorder_level
                )
            filters.append(Product.id.in_(low_variant))
        total = await self.session.scalar(select(func.count(Product.id)).where(*filters)) or 0
        products = list(
            await self.session.scalars(
                select(Product)
                .where(*filters)
                .order_by(Product.created_at.desc(), Product.name)
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        )
        return ProductPage(
            items=await self._views(products), page=page, page_size=page_size, total=total
        )

    async def get(self, product_id: uuid.UUID) -> Product:
        product = await self.session.scalar(
            select(Product).where(
                Product.id == product_id,
                Product.organization_id == self.user.organization_id,
            )
        )
        if product is None:
            raise AppError("PRODUCT_NOT_FOUND", "Product was not found", status_code=404)
        return product

    async def view(self, product_id: uuid.UUID) -> ProductView:
        return (await self._views([await self.get(product_id)]))[0]

    async def create(self, command: ProductCreate) -> ProductView:
        await self._ensure_category(command.category_id)
        sku = command.sku.strip().upper()
        if await self.session.scalar(
            select(Product.id).where(
                Product.organization_id == self.user.organization_id, Product.sku == sku
            )
        ):
            raise AppError(
                "DUPLICATE_SKU",
                f"Product SKU {sku} is already in use",
                status_code=409,
                details={"field": "sku"},
            )
        for variant in command.variants:
            await self._ensure_identifiers_free(variant.sku, variant.barcode)
        product = Product(
            organization_id=self.user.organization_id,
            category_id=command.category_id,
            name=command.name.strip(),
            sku=sku,
            description=command.description,
            image_url=str(command.image_url) if command.image_url else None,
            variants=[self._new_variant(variant) for variant in command.variants],
        )
        self.session.add(product)
        await self.session.flush()
        add_audit(
            self.session,
            self.user,
            "product.created",
            "product",
            product.id,
            new_data={"name": product.name, "sku": product.sku, "variants": len(product.variants)},
        )
        await self.session.commit()
        return await self.view(product.id)

    async def update(self, product_id: uuid.UUID, command: ProductUpdate) -> ProductView:
        product = await self.get(product_id)
        changes = command.model_dump(exclude_unset=True, mode="json")
        if "category_id" in changes:
            await self._ensure_category(command.category_id)
        old_data = {key: getattr(product, key) for key in changes}
        for key, value in changes.items():
            setattr(product, key, getattr(command, key) if key == "category_id" else value)
        if changes.get("is_active") is False:
            for variant in product.variants:
                variant.is_active = False
        add_audit(
            self.session,
            self.user,
            "product.updated",
            "product",
            product.id,
            old_data=old_data,
            new_data=changes,
        )
        await self.session.commit()
        return await self.view(product.id)

    async def deactivate(self, product_id: uuid.UUID) -> ProductView:
        """Products are never hard-deleted: sales, orders and the ledger still reference them."""
        return await self.update(product_id, ProductUpdate(is_active=False))

    # Variants ---------------------------------------------------------------------------------

    async def add_variant(self, product_id: uuid.UUID, command: VariantCreate) -> ProductView:
        product = await self.get(product_id)
        await self._ensure_identifiers_free(command.sku, command.barcode)
        variant = self._new_variant(command)
        product.variants.append(variant)
        await self.session.flush()
        add_audit(
            self.session,
            self.user,
            "variant.created",
            "product_variant",
            variant.id,
            new_data={"product_id": product.id, "sku": variant.sku, "price": variant.price},
        )
        await self.session.commit()
        return await self.view(product.id)

    async def update_variant(self, variant_id: uuid.UUID, command: VariantUpdate) -> ProductView:
        variant = await self.session.scalar(
            select(ProductVariant).where(
                ProductVariant.id == variant_id,
                ProductVariant.organization_id == self.user.organization_id,
            )
        )
        if variant is None:
            raise AppError("VARIANT_NOT_FOUND", "Product variant was not found", status_code=404)
        changes = command.model_dump(exclude_unset=True)
        if "sku" in changes and changes["sku"]:
            changes["sku"] = changes["sku"].strip().upper()
        if "barcode" in changes:
            changes["barcode"] = (changes["barcode"] or "").strip() or None
        await self._ensure_identifiers_free(
            changes.get("sku") if changes.get("sku") != variant.sku else None,
            changes.get("barcode") if changes.get("barcode") != variant.barcode else None,
        )
        old_data = {key: getattr(variant, key) for key in changes}
        for key, value in changes.items():
            setattr(variant, key, value)
        add_audit(
            self.session,
            self.user,
            "variant.updated",
            "product_variant",
            variant.id,
            old_data=old_data,
            new_data=changes,
        )
        await self.session.commit()
        return await self.view(variant.product_id)

    async def barcode(self, barcode: str) -> VariantView:
        variant = await self.session.scalar(
            select(ProductVariant).where(
                ProductVariant.organization_id == self.user.organization_id,
                ProductVariant.barcode == barcode.strip(),
                ProductVariant.is_active.is_(True),
            )
        )
        if variant is None:
            raise AppError(
                "BARCODE_NOT_FOUND", "No active product matches this barcode", status_code=404
            )
        stock = await self._stock([variant.id])
        return VariantView.model_validate(variant).model_copy(
            update={"available_quantity": stock.get(variant.id, 0)}
        )

    # Helpers ----------------------------------------------------------------------------------

    def _new_variant(self, variant: VariantCreate) -> ProductVariant:
        return ProductVariant(
            organization_id=self.user.organization_id,
            name=variant.name.strip(),
            sku=variant.sku.strip().upper(),
            barcode=variant.barcode.strip()
            if variant.barcode and variant.barcode.strip()
            else None,
            price=variant.price,
            cost=variant.cost,
            attributes=variant.attributes,
            reorder_level=variant.reorder_level,
        )

    async def _ensure_identifiers_free(self, sku: str | None, barcode: str | None) -> None:
        """Distinct, field-specific errors instead of a generic integrity failure."""
        org = self.user.organization_id
        if sku and await self.session.scalar(
            select(ProductVariant.id).where(
                ProductVariant.organization_id == org, ProductVariant.sku == sku.strip().upper()
            )
        ):
            raise AppError(
                "DUPLICATE_SKU",
                f"SKU {sku.strip().upper()} is already in use",
                status_code=409,
                details={"field": "sku"},
            )
        if (
            barcode
            and barcode.strip()
            and await self.session.scalar(
                select(ProductVariant.id).where(
                    ProductVariant.organization_id == org, ProductVariant.barcode == barcode.strip()
                )
            )
        ):
            raise AppError(
                "DUPLICATE_BARCODE",
                f"Barcode {barcode.strip()} is already in use",
                status_code=409,
                details={"field": "barcode"},
            )

    async def _stock(self, variant_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
        if not variant_ids:
            return {}
        rows = await self.session.execute(
            select(
                InventoryBalance.variant_id,
                InventoryBalance.physical_quantity - InventoryBalance.reserved_quantity,
            ).where(
                InventoryBalance.branch_id == self.user.branch_id,
                InventoryBalance.variant_id.in_(variant_ids),
            )
        )
        return {variant_id: int(available) for variant_id, available in rows.all()}

    async def _views(self, products: list[Product]) -> list[ProductView]:
        stock = await self._stock(
            [variant.id for product in products for variant in product.variants]
        )
        category_ids = {product.category_id for product in products if product.category_id}
        names: dict[uuid.UUID, str] = {}
        if category_ids:
            names = dict(
                (
                    await self.session.execute(
                        select(Category.id, Category.name).where(Category.id.in_(category_ids))
                    )
                ).all()
            )
        return [
            ProductView(
                id=product.id,
                name=product.name,
                sku=product.sku,
                description=product.description,
                category_id=product.category_id,
                category_name=names.get(product.category_id) if product.category_id else None,
                image_url=product.image_url,
                is_active=product.is_active,
                created_at=product.created_at,
                variants=[
                    VariantView.model_validate(variant).model_copy(
                        update={"available_quantity": stock.get(variant.id, 0)}
                    )
                    for variant in sorted(product.variants, key=lambda item: item.name)
                ],
            )
            for product in products
        ]
