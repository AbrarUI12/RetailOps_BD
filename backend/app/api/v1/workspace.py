"""Shell endpoints: navigation badge counts and command-palette search (plan §10–11)."""

from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import ColumnElement, func, or_, select, update

from app.api.deps import CurrentUser, SessionDep
from app.core.exceptions import AppError
from app.core.permissions import ROLE_PERMISSIONS
from app.models.entities import (
    Customer,
    InventoryBalance,
    Notification,
    Order,
    OrderStatus,
    Product,
    ProductVariant,
    Sale,
    Shipment,
    SyncConflict,
    User,
)
from app.utils.phone import normalize_bd_phone

router = APIRouter(tags=["workspace"])

ACTIONABLE_ORDER_STATUSES = (
    OrderStatus.PENDING_CONFIRMATION,
    OrderStatus.CONFIRMED,
    OrderStatus.PACKING,
    OrderStatus.READY_FOR_SHIPMENT,
)


class WorkspaceCounts(BaseModel):
    orders_to_action: int | None = None
    low_stock: int | None = None
    open_conflicts: int | None = None
    unread_notifications: int


class SearchHit(BaseModel):
    kind: Literal["product", "order", "customer", "sale", "shipment"]
    id: str
    title: str
    subtitle: str
    to: str


def _can(user: User, permission: str) -> bool:
    return permission in ROLE_PERMISSIONS[user.role.name]


def _unread(user: User) -> tuple[ColumnElement[bool], ...]:
    return (
        Notification.organization_id == user.organization_id,
        Notification.read_at.is_(None),
        or_(Notification.user_id.is_(None), Notification.user_id == user.id),
    )


@router.get("/workspace/counts", response_model=WorkspaceCounts)
async def counts(session: SessionDep, user: CurrentUser) -> WorkspaceCounts:
    """Badge numbers for the navigation. Areas the role cannot open are left out (null)."""
    result = WorkspaceCounts(
        unread_notifications=await session.scalar(
            select(func.count(Notification.id)).where(*_unread(user))
        )
        or 0
    )
    if _can(user, "order:read"):
        result.orders_to_action = await session.scalar(
            select(func.count(Order.id)).where(
                Order.organization_id == user.organization_id,
                Order.branch_id == user.branch_id,
                Order.status.in_(ACTIONABLE_ORDER_STATUSES),
            )
        )
    if _can(user, "inventory:read"):
        result.low_stock = await session.scalar(
            select(func.count(InventoryBalance.id))
            .join(ProductVariant, ProductVariant.id == InventoryBalance.variant_id)
            .where(
                InventoryBalance.organization_id == user.organization_id,
                InventoryBalance.branch_id == user.branch_id,
                ProductVariant.is_active.is_(True),
                InventoryBalance.physical_quantity - InventoryBalance.reserved_quantity
                <= ProductVariant.reorder_level,
            )
        )
        result.open_conflicts = await session.scalar(
            select(func.count(SyncConflict.id)).where(
                SyncConflict.organization_id == user.organization_id,
                SyncConflict.reviewed_at.is_(None),
            )
        )
    return result


@router.post("/notifications/read-all", status_code=204)
async def mark_all_read(session: SessionDep, user: CurrentUser) -> None:
    await session.execute(
        update(Notification).where(*_unread(user)).values(read_at=datetime.now(UTC))
    )
    await session.commit()


@router.get("/search", response_model=list[SearchHit])
async def search(
    session: SessionDep,
    user: CurrentUser,
    q: str = Query(min_length=2, max_length=80),
) -> list[SearchHit]:
    """One query across products/barcodes, orders, customers/phones, invoices and tracking codes,
    limited to what the role may open."""
    term = q.strip()
    like = f"%{term}%"
    try:
        phone = normalize_bd_phone(term)
    except AppError:
        phone = None
    hits: list[SearchHit] = []
    org = user.organization_id

    if _can(user, "product:read"):
        rows = await session.execute(
            select(Product, ProductVariant)
            .join(ProductVariant, ProductVariant.product_id == Product.id)
            .where(
                Product.organization_id == org,
                or_(
                    Product.name.ilike(like),
                    Product.sku.ilike(like),
                    ProductVariant.sku.ilike(like),
                    ProductVariant.barcode == term,
                ),
            )
            .limit(6)
        )
        for product, variant in rows.all():
            hits.append(
                SearchHit(
                    kind="product",
                    id=str(product.id),
                    title=f"{product.name} · {variant.name}",
                    subtitle=f"{variant.sku}{f' · {variant.barcode}' if variant.barcode else ''}",
                    to=f"/products?focus={product.id}",
                )
            )
    if _can(user, "customer:read"):
        condition: ColumnElement[bool] = Customer.name.ilike(like)
        if phone:
            condition = or_(condition, Customer.normalized_phone == phone)
        for customer in await session.scalars(
            select(Customer).where(Customer.organization_id == org, condition).limit(5)
        ):
            hits.append(
                SearchHit(
                    kind="customer",
                    id=str(customer.id),
                    title=customer.name,
                    subtitle=customer.phone,
                    to=f"/customers?focus={customer.id}",
                )
            )
    if _can(user, "order:read"):
        order_rows = await session.execute(
            select(Order, Customer)
            .join(Customer, Customer.id == Order.customer_id)
            .where(
                Order.organization_id == org,
                or_(
                    Order.order_number.ilike(like),
                    *([Customer.normalized_phone == phone] if phone else []),
                ),
            )
            .order_by(Order.created_at.desc())
            .limit(5)
        )
        for order, customer in order_rows.all():
            hits.append(
                SearchHit(
                    kind="order",
                    id=str(order.id),
                    title=order.order_number,
                    subtitle=f"{customer.name} · {order.status.value.replace('_', ' ').lower()}",
                    to=f"/orders?focus={order.id}",
                )
            )
        for shipment in await session.scalars(
            select(Shipment)
            .where(Shipment.organization_id == org, Shipment.tracking_code.ilike(like))
            .limit(3)
        ):
            hits.append(
                SearchHit(
                    kind="shipment",
                    id=str(shipment.id),
                    title=shipment.tracking_code,
                    subtitle=f"{shipment.provider} · {shipment.status.replace('_', ' ').lower()}",
                    to=f"/orders?focus={shipment.order_id}",
                )
            )
    if _can(user, "sale:create"):
        for sale in await session.scalars(
            select(Sale)
            .where(Sale.organization_id == org, Sale.invoice_number.ilike(like))
            .limit(5)
        ):
            hits.append(
                SearchHit(
                    kind="sale",
                    id=str(sale.id),
                    title=sale.invoice_number,
                    subtitle=f"POS sale · ৳{sale.total}",
                    to=f"/pos?sale={sale.id}",
                )
            )
    return hits
