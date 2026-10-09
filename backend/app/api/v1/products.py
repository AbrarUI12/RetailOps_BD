import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import SessionDep, require_permission
from app.models.entities import User
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
from app.services.product_service import ProductService

router = APIRouter(tags=["products"])
Reader = Annotated[User, Depends(require_permission("product:read"))]
Writer = Annotated[User, Depends(require_permission("product:write"))]


@router.get("/categories", response_model=list[CategoryView])
async def list_categories(session: SessionDep, user: Reader) -> list[CategoryView]:
    return await ProductService(session, user).categories()


@router.post("/categories", response_model=CategoryView, status_code=status.HTTP_201_CREATED)
async def create_category(
    command: CategoryCreate, session: SessionDep, user: Writer
) -> CategoryView:
    return await ProductService(session, user).create_category(command)


@router.patch("/categories/{category_id}", response_model=CategoryView)
async def rename_category(
    category_id: uuid.UUID, command: CategoryUpdate, session: SessionDep, user: Writer
) -> CategoryView:
    return await ProductService(session, user).update_category(category_id, command)


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(category_id: uuid.UUID, session: SessionDep, user: Writer) -> None:
    await ProductService(session, user).delete_category(category_id)


@router.get("/products", response_model=ProductPage)
async def list_products(
    session: SessionDep,
    user: Reader,
    search: str | None = None,
    category_id: uuid.UUID | None = None,
    active: bool | None = None,
    stock: StockFilter | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 25,
) -> ProductPage:
    return await ProductService(session, user).list_products(
        search, page, page_size, category_id=category_id, active=active, stock=stock
    )


@router.post("/products", response_model=ProductView, status_code=status.HTTP_201_CREATED)
async def create_product(command: ProductCreate, session: SessionDep, user: Writer) -> ProductView:
    return await ProductService(session, user).create(command)


@router.get("/products/barcode/{barcode}", response_model=VariantView)
async def barcode_lookup(barcode: str, session: SessionDep, user: Reader) -> VariantView:
    return await ProductService(session, user).barcode(barcode)


@router.get("/products/{product_id}", response_model=ProductView)
async def get_product(product_id: uuid.UUID, session: SessionDep, user: Reader) -> ProductView:
    return await ProductService(session, user).view(product_id)


@router.patch("/products/{product_id}", response_model=ProductView)
async def update_product(
    product_id: uuid.UUID, command: ProductUpdate, session: SessionDep, user: Writer
) -> ProductView:
    return await ProductService(session, user).update(product_id, command)


@router.delete("/products/{product_id}", response_model=ProductView)
async def deactivate_product(
    product_id: uuid.UUID, session: SessionDep, user: Writer
) -> ProductView:
    """Soft delete: the product and its variants stop selling but history stays intact."""
    return await ProductService(session, user).deactivate(product_id)


@router.get("/products/{product_id}/variants", response_model=list[VariantView])
async def list_variants(
    product_id: uuid.UUID, session: SessionDep, user: Reader
) -> list[VariantView]:
    return (await ProductService(session, user).view(product_id)).variants


@router.post(
    "/products/{product_id}/variants",
    response_model=ProductView,
    status_code=status.HTTP_201_CREATED,
)
async def add_variant(
    product_id: uuid.UUID, command: VariantCreate, session: SessionDep, user: Writer
) -> ProductView:
    return await ProductService(session, user).add_variant(product_id, command)


@router.patch("/variants/{variant_id}", response_model=ProductView)
async def update_variant(
    variant_id: uuid.UUID, command: VariantUpdate, session: SessionDep, user: Writer
) -> ProductView:
    return await ProductService(session, user).update_variant(variant_id, command)
