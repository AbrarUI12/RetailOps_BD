import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import SessionDep, require_permission
from app.models.entities import User
from app.schemas.operations import ReturnCreate, ReturnView
from app.schemas.sales import CreateSaleRequest, RefundSaleRequest, SalePage, SaleView
from app.services.returns_service import ReturnsService
from app.services.sales_service import SalesService

router = APIRouter(prefix="/pos/sales", tags=["point of sale"])


@router.post("", response_model=SaleView, status_code=status.HTTP_201_CREATED)
async def create_sale(
    command: CreateSaleRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("sale:create"))],
) -> SaleView:
    return await SalesService(session, user).create(command)


@router.get("", response_model=SalePage)
async def list_sales(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("sale:create"))],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
    search: Annotated[str | None, Query(max_length=100)] = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> SalePage:
    return await SalesService(session, user).list(
        page=page,
        page_size=page_size,
        search=search,
        date_from=date_from,
        date_to=date_to,
    )


@router.get("/{sale_id}", response_model=SaleView)
async def get_sale(
    sale_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("sale:create"))],
) -> SaleView:
    return await SalesService(session, user).get(sale_id)


@router.post("/{sale_id}/refund", response_model=ReturnView, status_code=status.HTTP_201_CREATED)
async def refund_sale(
    sale_id: uuid.UUID,
    command: RefundSaleRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("sale:refund"))],
) -> ReturnView:
    """Receive a full or partial POS return; the service enforces sold-minus-returned limits."""
    return await ReturnsService(session, user).receive(
        ReturnCreate(
            sale_id=sale_id,
            reason=command.reason,
            items=[item.model_dump() for item in command.items],
        )
    )
