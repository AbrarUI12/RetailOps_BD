import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import SessionDep, require_permission
from app.models.entities import User
from app.schemas.products import ProductCreate, ProductPage, ProductUpdate, ProductView, VariantView
from app.services.product_service import ProductService

router = APIRouter(prefix="/products", tags=["products"])


@router.get("", response_model=ProductPage)
async def list_products(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("product:read"))],
    search: str | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> ProductPage:
    return await ProductService(session, user).list(search, page, page_size)


@router.post("", response_model=ProductView, status_code=status.HTTP_201_CREATED)
async def create_product(
    command: ProductCreate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("product:write"))],
) -> ProductView:
    return ProductView.model_validate(await ProductService(session, user).create(command))


@router.get("/barcode/{barcode}", response_model=VariantView)
async def barcode_lookup(
    barcode: str,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("product:read"))],
) -> VariantView:
    return VariantView.model_validate(await ProductService(session, user).barcode(barcode))


@router.get("/{product_id}", response_model=ProductView)
async def get_product(
    product_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("product:read"))],
) -> ProductView:
    return ProductView.model_validate(await ProductService(session, user).get(product_id))


@router.patch("/{product_id}", response_model=ProductView)
async def update_product(
    product_id: uuid.UUID,
    command: ProductUpdate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("product:write"))],
) -> ProductView:
    return ProductView.model_validate(
        await ProductService(session, user).update(product_id, command)
    )
