import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import SessionDep, require_permission
from app.models.entities import User
from app.schemas.operations import CustomerCreate, CustomerView
from app.services.customer_service import CustomerService

router = APIRouter(prefix="/customers", tags=["customers"])


@router.get("", response_model=list[CustomerView])
async def list_customers(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("customer:read"))],
    search: str | None = Query(default=None, max_length=100),
) -> list[CustomerView]:
    return await CustomerService(session, user).list_customers(search)


@router.post("", response_model=CustomerView, status_code=status.HTTP_201_CREATED)
async def create_customer(
    command: CustomerCreate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("customer:write"))],
) -> CustomerView:
    return await CustomerService(session, user).create(command)


@router.get("/{customer_id}", response_model=CustomerView)
async def get_customer(
    customer_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("customer:read"))],
) -> CustomerView:
    return await CustomerService(session, user).get(customer_id)
