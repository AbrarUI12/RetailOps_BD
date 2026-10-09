import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import SessionDep, require_permission
from app.models.entities import User
from app.schemas.customers import (
    CustomerAddressCreate,
    CustomerAddressView,
    CustomerProfile,
    CustomerPurchaseView,
    CustomerUpdate,
)
from app.schemas.operations import CustomerCreate, CustomerView, RiskView
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


@router.get("/lookup", response_model=CustomerView)
async def lookup_customer(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("customer:read"))],
    phone: str = Query(min_length=8, max_length=32),
) -> CustomerView:
    return await CustomerService(session, user).lookup(phone)


@router.get("/{customer_id}", response_model=CustomerView)
async def get_customer(
    customer_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("customer:read"))],
) -> CustomerView:
    return await CustomerService(session, user).get(customer_id)


@router.patch("/{customer_id}", response_model=CustomerView)
async def update_customer(
    customer_id: uuid.UUID,
    command: CustomerUpdate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("customer:write"))],
) -> CustomerView:
    return await CustomerService(session, user).update(customer_id, command)


@router.get("/{customer_id}/profile", response_model=CustomerProfile)
async def get_customer_profile(
    customer_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("customer:read"))],
) -> CustomerProfile:
    return await CustomerService(session, user).profile(customer_id)


@router.get("/{customer_id}/orders", response_model=list[CustomerPurchaseView])
async def get_customer_orders(
    customer_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("customer:read"))],
) -> list[CustomerPurchaseView]:
    return await CustomerService(session, user).orders(customer_id)


@router.get("/{customer_id}/risk", response_model=RiskView)
async def get_customer_risk(
    customer_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("customer:read"))],
) -> RiskView:
    return await CustomerService(session, user).risk(customer_id)


@router.post(
    "/{customer_id}/addresses",
    response_model=CustomerAddressView,
    status_code=status.HTTP_201_CREATED,
)
async def add_customer_address(
    customer_id: uuid.UUID,
    command: CustomerAddressCreate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("customer:write"))],
) -> CustomerAddressView:
    return await CustomerService(session, user).add_address(customer_id, command)
