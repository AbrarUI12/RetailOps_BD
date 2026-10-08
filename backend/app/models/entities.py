import uuid
from datetime import UTC, datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def utc_now() -> datetime:
    return datetime.now(UTC)


class UserRole(StrEnum):
    OWNER = "OWNER"
    MANAGER = "MANAGER"
    CASHIER = "CASHIER"
    SUPPORT = "SUPPORT"
    WAREHOUSE = "WAREHOUSE"


class PaymentMethod(StrEnum):
    CASH = "CASH"
    BKASH = "BKASH"
    NAGAD = "NAGAD"
    CARD = "CARD"
    SPLIT = "SPLIT"
    COD = "COD"


class OrderStatus(StrEnum):
    DRAFT = "DRAFT"
    PENDING_CONFIRMATION = "PENDING_CONFIRMATION"
    CONFIRMED = "CONFIRMED"
    PACKING = "PACKING"
    READY_FOR_SHIPMENT = "READY_FOR_SHIPMENT"
    SHIPPED = "SHIPPED"
    DELIVERED = "DELIVERED"
    CANCELLED = "CANCELLED"
    RETURN_REQUESTED = "RETURN_REQUESTED"
    RETURNED = "RETURNED"
    FAILED_DELIVERY = "FAILED_DELIVERY"


class OrderSource(StrEnum):
    POS = "POS"
    FACEBOOK = "FACEBOOK"
    INSTAGRAM = "INSTAGRAM"
    PHONE = "PHONE"
    WEBSITE = "WEBSITE"
    WHATSAPP = "WHATSAPP"
    OTHER = "OTHER"


class SyncStatus(StrEnum):
    PENDING = "PENDING"
    SYNCING = "SYNCING"
    SYNCED = "SYNCED"
    FAILED = "FAILED"
    CONFLICT = "CONFLICT"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )


class Organization(Base, TimestampMixin):
    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(160))
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Dhaka")


class Branch(Base, TimestampMixin):
    __tablename__ = "branches"
    __table_args__ = (UniqueConstraint("organization_id", "code"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    code: Mapped[str] = mapped_column(String(24))
    address: Mapped[str | None] = mapped_column(Text)


role_permissions = Table(
    "role_permissions",
    Base.metadata,
    Column("role_id", ForeignKey("roles.id"), primary_key=True),
    Column("permission_id", ForeignKey("permissions.id"), primary_key=True),
)


class Permission(Base):
    __tablename__ = "permissions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(80), unique=True)
    description: Mapped[str] = mapped_column(String(200))


class Role(Base):
    __tablename__ = "roles"
    __table_args__ = (UniqueConstraint("organization_id", "name"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    name: Mapped[UserRole] = mapped_column(Enum(UserRole, native_enum=False))
    permissions: Mapped[list[Permission]] = relationship(
        secondary=role_permissions, lazy="selectin"
    )


class User(Base, TimestampMixin):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("organization_id", "email"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"), index=True)
    role_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("roles.id"), index=True)
    email: Mapped[str] = mapped_column(String(254))
    full_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    role: Mapped[Role] = relationship(lazy="selectin")


class RefreshSession(Base, TimestampMixin):
    __tablename__ = "refresh_sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    family_id: Mapped[uuid.UUID] = mapped_column(index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    user_agent: Mapped[str | None] = mapped_column(String(300))


class Category(Base, TimestampMixin):
    __tablename__ = "categories"
    __table_args__ = (UniqueConstraint("organization_id", "name"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    slug: Mapped[str] = mapped_column(String(100))


class Product(Base, TimestampMixin):
    __tablename__ = "products"
    __table_args__ = (UniqueConstraint("organization_id", "sku"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    category_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("categories.id"), index=True)
    name: Mapped[str] = mapped_column(String(180), index=True)
    sku: Mapped[str] = mapped_column(String(64))
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    variants: Mapped[list["ProductVariant"]] = relationship(
        back_populates="product", cascade="all, delete-orphan", lazy="selectin"
    )


class ProductVariant(Base, TimestampMixin):
    __tablename__ = "product_variants"
    __table_args__ = (
        UniqueConstraint("organization_id", "sku"),
        UniqueConstraint("organization_id", "barcode"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id"), index=True)
    name: Mapped[str] = mapped_column(String(140))
    sku: Mapped[str] = mapped_column(String(64))
    barcode: Mapped[str | None] = mapped_column(String(80), nullable=True)
    price: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    cost: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    attributes: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    reorder_level: Mapped[int] = mapped_column(Integer, default=5)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    product: Mapped[Product] = relationship(back_populates="variants")


class InventoryBalance(Base, TimestampMixin):
    __tablename__ = "inventory_balances"
    __table_args__ = (UniqueConstraint("branch_id", "variant_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"), index=True)
    variant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_variants.id"), index=True)
    physical_quantity: Mapped[int] = mapped_column(Integer, default=0)
    reserved_quantity: Mapped[int] = mapped_column(Integer, default=0)

    @property
    def available_quantity(self) -> int:
        return self.physical_quantity - self.reserved_quantity


class InventoryMovement(Base):
    __tablename__ = "inventory_movements"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"), index=True)
    variant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_variants.id"), index=True)
    movement_type: Mapped[str] = mapped_column(String(40), index=True)
    quantity_delta: Mapped[int] = mapped_column(Integer)
    previous_quantity: Mapped[int] = mapped_column(Integer)
    new_quantity: Mapped[int] = mapped_column(Integer)
    reference_type: Mapped[str | None] = mapped_column(String(40))
    reference_id: Mapped[uuid.UUID | None] = mapped_column(index=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, index=True
    )


class Customer(Base, TimestampMixin):
    __tablename__ = "customers"
    __table_args__ = (Index("ix_customers_org_phone", "organization_id", "normalized_phone"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    name: Mapped[str] = mapped_column(String(140))
    phone: Mapped[str] = mapped_column(String(32))
    normalized_phone: Mapped[str] = mapped_column(String(20))
    phone_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text)


class CustomerAddress(Base, TimestampMixin):
    __tablename__ = "customer_addresses"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("customers.id"), index=True)
    label: Mapped[str] = mapped_column(String(40), default="Home")
    address: Mapped[str] = mapped_column(Text)
    area: Mapped[str | None] = mapped_column(String(100))
    city: Mapped[str] = mapped_column(String(80), default="Dhaka")


class Sale(Base, TimestampMixin):
    __tablename__ = "sales"
    __table_args__ = (
        UniqueConstraint("organization_id", "invoice_number"),
        UniqueConstraint("organization_id", "client_transaction_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"), index=True)
    cashier_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    customer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("customers.id"))
    invoice_number: Mapped[str] = mapped_column(String(40))
    client_transaction_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    discount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    total: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    synced_offline: Mapped[bool] = mapped_column(Boolean, default=False)
    items: Mapped[list["SaleItem"]] = relationship(cascade="all, delete-orphan", lazy="selectin")
    payments: Mapped[list["Payment"]] = relationship(cascade="all, delete-orphan", lazy="selectin")


class SaleItem(Base):
    __tablename__ = "sale_items"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    sale_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sales.id"), index=True)
    variant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_variants.id"), index=True)
    product_name: Mapped[str] = mapped_column(String(180))
    variant_name: Mapped[str] = mapped_column(String(140))
    sku: Mapped[str] = mapped_column(String(64))
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    line_total: Mapped[Decimal] = mapped_column(Numeric(14, 2))


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    sale_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("sales.id"), index=True)
    order_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("orders.id"), index=True)
    method: Mapped[PaymentMethod] = mapped_column(Enum(PaymentMethod, native_enum=False))
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    reference: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class Order(Base, TimestampMixin):
    __tablename__ = "orders"
    __table_args__ = (UniqueConstraint("organization_id", "order_number"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"), index=True)
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("customers.id"), index=True)
    order_number: Mapped[str] = mapped_column(String(40))
    source: Mapped[OrderSource] = mapped_column(Enum(OrderSource, native_enum=False))
    status: Mapped[OrderStatus] = mapped_column(Enum(OrderStatus, native_enum=False), index=True)
    delivery_address: Mapped[str] = mapped_column(Text)
    area: Mapped[str | None] = mapped_column(String(100))
    subtotal: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    delivery_fee: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    discount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    total: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    cod_risk_score: Mapped[int] = mapped_column(Integer, default=0)
    cod_risk_level: Mapped[str] = mapped_column(String(20), default="LOW")
    risk_reasons: Mapped[list[str]] = mapped_column(JSON, default=list)
    items: Mapped[list["OrderItem"]] = relationship(cascade="all, delete-orphan", lazy="selectin")


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id"), index=True)
    variant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_variants.id"), index=True)
    product_name: Mapped[str] = mapped_column(String(180))
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    line_total: Mapped[Decimal] = mapped_column(Numeric(14, 2))


class InventoryReservation(Base):
    __tablename__ = "inventory_reservations"
    __table_args__ = (UniqueConstraint("order_id", "variant_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"), index=True)
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id"), index=True)
    variant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_variants.id"), index=True)
    quantity: Mapped[int] = mapped_column(Integer)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class OrderStatusEvent(Base):
    __tablename__ = "order_status_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id"), index=True)
    from_status: Mapped[str | None] = mapped_column(String(30))
    to_status: Mapped[str] = mapped_column(String(30))
    changed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class Shipment(Base, TimestampMixin):
    __tablename__ = "shipments"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id"), unique=True)
    provider: Mapped[str] = mapped_column(String(40), default="MOCK")
    tracking_code: Mapped[str] = mapped_column(String(80), unique=True)
    status: Mapped[str] = mapped_column(String(40), default="CREATED")


class ShipmentEvent(Base):
    __tablename__ = "shipment_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    shipment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("shipments.id"), index=True)
    status: Mapped[str] = mapped_column(String(40))
    description: Mapped[str] = mapped_column(String(240))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class Return(Base, TimestampMixin):
    __tablename__ = "returns"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"), index=True)
    order_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("orders.id"))
    sale_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("sales.id"))
    status: Mapped[str] = mapped_column(String(30), default="RECEIVED")
    reason: Mapped[str] = mapped_column(String(200))


class ReturnItem(Base):
    __tablename__ = "return_items"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    return_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("returns.id"), index=True)
    variant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_variants.id"), index=True)
    quantity: Mapped[int] = mapped_column(Integer)
    disposition: Mapped[str] = mapped_column(String(20))


class Supplier(Base, TimestampMixin):
    __tablename__ = "suppliers"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    name: Mapped[str] = mapped_column(String(140))
    phone: Mapped[str | None] = mapped_column(String(24))
    email: Mapped[str | None] = mapped_column(String(254))


class Purchase(Base, TimestampMixin):
    __tablename__ = "purchases"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"), index=True)
    supplier_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("suppliers.id"), index=True)
    reference: Mapped[str] = mapped_column(String(60), unique=True)
    status: Mapped[str] = mapped_column(String(20), default="DRAFT")
    total: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))


class PurchaseItem(Base):
    __tablename__ = "purchase_items"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    purchase_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("purchases.id"), index=True)
    variant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_variants.id"), index=True)
    quantity: Mapped[int] = mapped_column(Integer)
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(14, 2))


class Device(Base, TimestampMixin):
    __tablename__ = "devices"
    __table_args__ = (UniqueConstraint("organization_id", "device_key"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    device_key: Mapped[str] = mapped_column(String(80))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SyncTransaction(Base, TimestampMixin):
    __tablename__ = "sync_transactions"
    __table_args__ = (UniqueConstraint("organization_id", "client_transaction_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    device_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("devices.id"))
    client_transaction_id: Mapped[uuid.UUID] = mapped_column(index=True)
    transaction_type: Mapped[str] = mapped_column(String(40))
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    status: Mapped[SyncStatus] = mapped_column(Enum(SyncStatus, native_enum=False))
    server_record_id: Mapped[uuid.UUID | None]
    error: Mapped[str | None] = mapped_column(Text)


class SyncConflict(Base, TimestampMixin):
    __tablename__ = "sync_conflicts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    sync_transaction_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sync_transactions.id"), index=True
    )
    conflict_type: Mapped[str] = mapped_column(String(40))
    details: Mapped[dict[str, Any]] = mapped_column(JSON)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Notification(Base, TimestampMixin):
    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    kind: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(160))
    message: Mapped[str] = mapped_column(Text)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    entity_type: Mapped[str | None] = mapped_column(String(40))
    entity_id: Mapped[uuid.UUID | None]


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), index=True)
    action: Mapped[str] = mapped_column(String(80), index=True)
    entity_type: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[uuid.UUID | None] = mapped_column(index=True)
    old_data: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    new_data: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    request_id: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, index=True
    )
