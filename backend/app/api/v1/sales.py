import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.api.deps import SessionDep, require_permission
from app.models.entities import User
from app.schemas.sales import CreateSaleRequest, SaleView
from app.services.sales_service import SalesService

router = APIRouter(prefix="/pos/sales", tags=["point of sale"])


@router.post("", response_model=SaleView, status_code=status.HTTP_201_CREATED)
async def create_sale(
    command: CreateSaleRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("sale:create"))],
) -> SaleView:
    return await SalesService(session, user).create(command)


@router.get("/{sale_id}", response_model=SaleView)
async def get_sale(
    sale_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("sale:create"))],
) -> SaleView:
    return await SalesService(session, user).get(sale_id)
