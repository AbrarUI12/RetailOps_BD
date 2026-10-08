import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.models.entities import Category, Product, ProductVariant, User
from app.schemas.products import ProductCreate, ProductPage, ProductUpdate, ProductView
from app.services.audit_service import add_audit


class ProductService:
    def __init__(self, session: AsyncSession, user: User) -> None:
        self.session = session
        self.user = user

    async def list(self, search: str | None, page: int, page_size: int) -> ProductPage:
        filters = [Product.organization_id == self.user.organization_id]
        if search:
            term = f"%{search.strip()}%"
            filters.append(or_(Product.name.ilike(term), Product.sku.ilike(term)))
        total = await self.session.scalar(select(func.count(Product.id)).where(*filters)) or 0
        products = list(
            (
                await self.session.scalars(
                    select(Product)
                    .where(*filters)
                    .order_by(Product.created_at.desc())
                    .offset((page - 1) * page_size)
                    .limit(page_size)
                )
            ).unique()
        )
        return ProductPage(
            items=[ProductView.model_validate(product) for product in products],
            page=page,
            page_size=page_size,
            total=total,
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

    async def _ensure_category(self, category_id: uuid.UUID | None) -> None:
        if category_id and not await self.session.scalar(
            select(Category.id).where(
                Category.id == category_id,
                Category.organization_id == self.user.organization_id,
            )
        ):
            raise AppError("CATEGORY_NOT_FOUND", "Category was not found", status_code=404)

    async def create(self, command: ProductCreate) -> Product:
        await self._ensure_category(command.category_id)
        product = Product(
            organization_id=self.user.organization_id,
            category_id=command.category_id,
            name=command.name.strip(),
            sku=command.sku.strip().upper(),
            description=command.description,
        )
        for variant in command.variants:
            product.variants.append(
                ProductVariant(
                    organization_id=self.user.organization_id,
                    name=variant.name.strip(),
                    sku=variant.sku.strip().upper(),
                    barcode=variant.barcode.strip() if variant.barcode else None,
                    price=variant.price,
                    cost=variant.cost,
                    attributes=variant.attributes,
                    reorder_level=variant.reorder_level,
                )
            )
        self.session.add(product)
        try:
            await self.session.flush()
            add_audit(
                self.session,
                self.user,
                "product.created",
                "product",
                product.id,
                new_data={"name": product.name, "sku": product.sku},
            )
            await self.session.commit()
            await self.session.refresh(product)
            return await self.get(product.id)
        except IntegrityError as exc:
            await self.session.rollback()
            raise AppError(
                "DUPLICATE_PRODUCT_IDENTIFIER",
                "A product, SKU, or barcode already uses this identifier",
                status_code=409,
            ) from exc

    async def update(self, product_id: uuid.UUID, command: ProductUpdate) -> Product:
        product = await self.get(product_id)
        changes = command.model_dump(exclude_unset=True)
        if "category_id" in changes:
            await self._ensure_category(changes["category_id"])
        old_data = {key: getattr(product, key) for key in changes}
        for key, value in changes.items():
            setattr(product, key, value)
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
        return await self.get(product.id)

    async def barcode(self, barcode: str) -> ProductVariant:
        variant = await self.session.scalar(
            select(ProductVariant).where(
                ProductVariant.organization_id == self.user.organization_id,
                ProductVariant.barcode == barcode,
                ProductVariant.is_active.is_(True),
            )
        )
        if variant is None:
            raise AppError(
                "BARCODE_NOT_FOUND", "No active product matches this barcode", status_code=404
            )
        return variant
