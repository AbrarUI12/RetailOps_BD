"""Create a deterministic, idempotent portfolio/demo tenant with convincing history."""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.core.database import session_factory
from app.core.permissions import ALL_PERMISSIONS, ROLE_PERMISSIONS
from app.core.security import hash_password
from app.models.entities import (
    AuditLog,
    Branch,
    Category,
    Customer,
    CustomerAddress,
    Notification,
    Order,
    OrderItem,
    OrderSource,
    OrderStatus,
    OrderStatusEvent,
    Organization,
    Payment,
    PaymentMethod,
    Permission,
    Product,
    ProductVariant,
    Return,
    ReturnItem,
    Role,
    Sale,
    SaleItem,
    Shipment,
    ShipmentEvent,
    User,
    UserRole,
)
from app.services.inventory_service import InventoryService

PASSWORD = "RetailOps123!"
DEMO_SLUG = "retailops-demo"
FIRST_NAMES = [
    "Ayesha",
    "Nusrat",
    "Farhana",
    "Sadia",
    "Tasnim",
    "Rafi",
    "Tanvir",
    "Arif",
    "Sakib",
    "Mahin",
]
LAST_NAMES = [
    "Rahman",
    "Islam",
    "Ahmed",
    "Hossain",
    "Akter",
    "Khan",
    "Chowdhury",
    "Hasan",
    "Karim",
    "Jahan",
]
AREAS = ["Dhanmondi", "Mirpur", "Uttara", "Banani", "Mohammadpur", "Bashundhara"]
SOURCES = [
    OrderSource.FACEBOOK,
    OrderSource.INSTAGRAM,
    OrderSource.PHONE,
    OrderSource.WHATSAPP,
    OrderSource.WEBSITE,
]
DHAKA = ZoneInfo("Asia/Dhaka")

# category, product, product SKU, variants: name, SKU, barcode, price, cost
CATALOG = [
    (
        "Apparel",
        "Essential Cotton T-Shirt",
        "TEE",
        [
            ("Black / M", "TEE-BLK-M", "100001", 890, 390),
            ("Black / L", "TEE-BLK-L", "100002", 890, 390),
            ("Sage / M", "TEE-SGE-M", "100003", 890, 390),
        ],
    ),
    (
        "Apparel",
        "Premium Panjabi",
        "PAN",
        [
            ("Ivory / M", "PAN-IV-M", "100004", 2490, 1320),
            ("Ivory / L", "PAN-IV-L", "100005", 2490, 1320),
            ("Navy / XL", "PAN-NV-XL", "100006", 2690, 1410),
        ],
    ),
    ("Footwear", "Everyday Sneakers", "SHOE", [("White / 42", "SHOE-W-42", "100007", 3290, 1810)]),
    ("Beauty", "Botanical Face Wash", "FACE", [("120 ml", "FACE-120", "100008", 650, 310)]),
    (
        "Electronics",
        "Wireless Headphones",
        "HEAD",
        [("Midnight", "HEAD-MID", "100009", 4590, 2670)],
    ),
    (
        "Accessories",
        "Shockproof Phone Case",
        "CASE",
        [("Clear / Universal", "CASE-CLR", "100010", 590, 180)],
    ),
    (
        "Electronics",
        "Fast-Charge Power Bank",
        "POWER",
        [("10,000 mAh", "POWER-10K", "100011", 2190, 1290)],
    ),
    ("Accessories", "Leather Wallet", "WALLET", [("Walnut", "WALLET-WN", "100012", 1290, 540)]),
    ("Home", "Nakshi Cushion Cover", "CUSHION", [("Crimson", "CUSHION-CR", "100013", 790, 330)]),
    ("Food", "Premium Tea Gift Box", "TEA", [("6 blends", "TEA-GIFT", "100014", 1490, 760)]),
]


def when(days_ago: int, hour: int = 12) -> datetime:
    local = (datetime.now(DHAKA) - timedelta(days=days_ago)).replace(
        hour=hour, minute=0, second=0, microsecond=0
    )
    return local.astimezone(UTC)


def order_status(index: int) -> OrderStatus:
    bucket = index % 20
    if bucket < 12:
        return OrderStatus.DELIVERED
    if bucket < 15:
        return OrderStatus.FAILED_DELIVERY
    if bucket == 15:
        return OrderStatus.CANCELLED
    if bucket == 16:
        return OrderStatus.SHIPPED
    if bucket == 17:
        return OrderStatus.PENDING_CONFIRMATION
    if bucket == 18:
        return OrderStatus.CONFIRMED
    return OrderStatus.RETURNED


async def seed() -> None:
    async with session_factory() as session:
        existing = await session.scalar(select(Organization).where(Organization.slug == DEMO_SLUG))
        if existing:
            print("Demo tenant already exists; no changes made.")
            return

        organization = Organization(name="RetailOps Demo Store", slug=DEMO_SLUG)
        session.add(organization)
        await session.flush()
        branch = Branch(
            organization_id=organization.id,
            name="Dhanmondi Flagship",
            code="DHK-01",
            address="Road 27, Dhanmondi, Dhaka",
        )
        session.add(branch)
        permissions = {
            code: Permission(code=code, description=code.replace(":", " ").title())
            for code in sorted(ALL_PERMISSIONS)
        }
        session.add_all(permissions.values())
        roles: dict[UserRole, Role] = {}
        for role_name, permission_codes in ROLE_PERMISSIONS.items():
            role = Role(
                organization_id=organization.id,
                name=role_name,
                permissions=[permissions[code] for code in sorted(permission_codes)],
            )
            roles[role_name] = role
            session.add(role)
        await session.flush()

        password_hash = hash_password(PASSWORD)
        users = [
            ("owner@demo.local", "Abrar Rahman", UserRole.OWNER),
            ("manager@demo.local", "Nusrat Jahan", UserRole.MANAGER),
            ("cashier@demo.local", "Tanvir Ahmed", UserRole.CASHIER),
            ("support@demo.local", "Sadia Islam", UserRole.SUPPORT),
            ("warehouse@demo.local", "Rafi Hasan", UserRole.WAREHOUSE),
        ]
        staff = [
            User(
                organization_id=organization.id,
                branch_id=branch.id,
                role_id=roles[role].id,
                email=email,
                full_name=name,
                password_hash=password_hash,
            )
            for email, name, role in users
        ]
        session.add_all(staff)
        await session.flush()
        owner, _, cashier, *_ = staff
        await session.refresh(owner, ["role"])
        inventory = InventoryService(session, owner)

        categories: dict[str, Category] = {}
        for category_name, *_ in CATALOG:
            if category_name not in categories:
                category = Category(
                    organization_id=organization.id, name=category_name, slug=category_name.lower()
                )
                categories[category_name] = category
                session.add(category)
        await session.flush()

        variants: list[ProductVariant] = []
        for category_name, name, sku, variant_specs in CATALOG:
            product = Product(
                organization_id=organization.id,
                category_id=categories[category_name].id,
                name=name,
                sku=sku,
                description=f"Demo catalog item: {name}",
            )
            for variant_name, variant_sku, barcode, price, cost in variant_specs:
                variant = ProductVariant(
                    organization_id=organization.id,
                    name=variant_name,
                    sku=variant_sku,
                    barcode=barcode,
                    price=Decimal(price),
                    cost=Decimal(cost),
                    reorder_level=8,
                )
                product.variants.append(variant)
                variants.append(variant)
            session.add(product)
        await session.flush()
        for variant in variants:
            movement = await inventory.apply_movement(
                variant_id=variant.id,
                quantity_delta=300,
                movement_type="OPENING_STOCK",
                note="Demo opening stock",
            )
            movement.created_at = when(210)

        customers: list[Customer] = []
        for index in range(120):
            customer = Customer(
                id=uuid.uuid4(),
                organization_id=organization.id,
                name=f"{FIRST_NAMES[index % 10]} {LAST_NAMES[(index * 3) % 10]}",
                phone=f"017{index:08d}",
                normalized_phone=f"+88017{index:08d}",
                phone_verified=index % 5 != 0,
                notes="Repeat online customer" if index % 8 == 0 else None,
                created_at=when(200 - (index % 180)),
            )
            customers.append(customer)
            session.add(customer)
            session.add(
                CustomerAddress(
                    organization_id=organization.id,
                    customer_id=customer.id,
                    label="Home",
                    address=f"House {index + 1}, Road {(index % 18) + 1}",
                    area=AREAS[index % len(AREAS)],
                    city="Dhaka",
                    created_at=customer.created_at,
                )
            )

        for index in range(320):
            customer = customers[index % len(customers)]
            variant = variants[(index * 5) % len(variants)]
            quantity = 1 + (index % 3 == 0)
            created_at = when(index % 180, 9 + index % 10)
            status = order_status(index)
            subtotal = variant.price * quantity
            delivery_fee = Decimal("80") if index % 3 else Decimal("120")
            discount = Decimal("100") if index % 9 == 0 else Decimal("0")
            total = subtotal + delivery_fee - discount
            risky = index % 13 == 0
            order = Order(
                id=uuid.uuid4(),
                organization_id=organization.id,
                branch_id=branch.id,
                customer_id=customer.id,
                order_number=f"ORD-DEMO-{index + 1:04d}",
                source=SOURCES[index % len(SOURCES)],
                status=status,
                delivery_address=f"House {index + 1}, {AREAS[index % len(AREAS)]}, Dhaka",
                area=AREAS[index % len(AREAS)],
                subtotal=subtotal,
                delivery_fee=delivery_fee,
                discount=discount,
                total=total,
                cod_risk_score=78 if risky else 18 + index % 28,
                cod_risk_level="VERY_HIGH" if risky else ("MEDIUM" if index % 6 == 0 else "LOW"),
                risk_reasons=["High previous return ratio", "Phone is unverified"]
                if risky
                else ["Established delivery history"],
                created_at=created_at,
                updated_at=created_at,
            )
            order.items.append(
                OrderItem(
                    organization_id=organization.id,
                    variant_id=variant.id,
                    product_name=variant.product.name,
                    quantity=quantity,
                    unit_price=variant.price,
                    line_total=subtotal,
                )
            )
            session.add(order)
            session.add(
                OrderStatusEvent(
                    organization_id=organization.id,
                    order_id=order.id,
                    from_status=None,
                    to_status=OrderStatus.PENDING_CONFIRMATION.value,
                    changed_by=staff[3].id,
                    note="Demo order captured",
                    created_at=created_at,
                )
            )
            if status != OrderStatus.PENDING_CONFIRMATION:
                session.add(
                    OrderStatusEvent(
                        organization_id=organization.id,
                        order_id=order.id,
                        from_status=OrderStatus.PENDING_CONFIRMATION.value,
                        to_status=status.value,
                        changed_by=owner.id,
                        note="Historical demo outcome",
                        created_at=created_at + timedelta(hours=4),
                    )
                )

            shipped = status in {
                OrderStatus.SHIPPED,
                OrderStatus.DELIVERED,
                OrderStatus.FAILED_DELIVERY,
                OrderStatus.RETURNED,
            }
            if shipped:
                movement = await inventory.apply_movement(
                    variant_id=variant.id,
                    quantity_delta=-quantity,
                    movement_type="ORDER_FULFILLMENT",
                    note=f"Demo shipment {order.order_number}",
                    reference_type="order",
                    reference_id=order.id,
                )
                movement.created_at = created_at + timedelta(hours=6)
                shipment = Shipment(
                    id=uuid.uuid4(),
                    organization_id=organization.id,
                    order_id=order.id,
                    provider="Pathao" if index % 2 else "Steadfast",
                    tracking_code=f"DEMO{index + 1:08d}",
                    status="DELIVERED"
                    if status == OrderStatus.DELIVERED
                    else "RETURNED"
                    if status in {OrderStatus.FAILED_DELIVERY, OrderStatus.RETURNED}
                    else "IN_TRANSIT",
                    created_at=created_at + timedelta(hours=5),
                    updated_at=created_at + timedelta(days=2),
                )
                session.add(shipment)
                session.add(
                    ShipmentEvent(
                        organization_id=organization.id,
                        shipment_id=shipment.id,
                        status=shipment.status,
                        description="Historical demo courier event",
                        occurred_at=created_at + timedelta(days=2),
                    )
                )
            if status == OrderStatus.DELIVERED:
                session.add(
                    Payment(
                        organization_id=organization.id,
                        order_id=order.id,
                        method=PaymentMethod.COD,
                        amount=total,
                        reference=f"COD-{index + 1:04d}",
                        created_at=created_at + timedelta(days=2),
                    )
                )
            elif status in {OrderStatus.FAILED_DELIVERY, OrderStatus.RETURNED}:
                returned = Return(
                    id=uuid.uuid4(),
                    organization_id=organization.id,
                    branch_id=branch.id,
                    order_id=order.id,
                    status="RECEIVED",
                    reason="Courier return to origin",
                    created_at=created_at + timedelta(days=4),
                    updated_at=created_at + timedelta(days=4),
                )
                session.add(returned)
                session.add(
                    ReturnItem(
                        organization_id=organization.id,
                        return_id=returned.id,
                        variant_id=variant.id,
                        quantity=quantity,
                        disposition="SELLABLE",
                    )
                )
                movement = await inventory.apply_movement(
                    variant_id=variant.id,
                    quantity_delta=quantity,
                    movement_type="RETURN_SELLABLE",
                    note="Demo courier return received",
                    reference_type="return",
                    reference_id=returned.id,
                )
                movement.created_at = returned.created_at

        payment_methods = [
            PaymentMethod.CASH,
            PaymentMethod.BKASH,
            PaymentMethod.NAGAD,
            PaymentMethod.CARD,
        ]
        for index in range(90):
            customer = customers[(index * 7) % len(customers)]
            variant = variants[(index * 3) % len(variants)]
            quantity = 2 if index % 7 == 0 else 1
            created_at = when(index % 60, 10 + index % 9)
            subtotal = variant.price * quantity
            discount = Decimal("150") if index % 11 == 0 else Decimal("0")
            total = subtotal - discount
            sale = Sale(
                id=uuid.uuid4(),
                organization_id=organization.id,
                branch_id=branch.id,
                cashier_id=cashier.id,
                customer_id=customer.id if index % 3 == 0 else None,
                invoice_number=f"INV-DEMO-{index + 1:04d}",
                client_transaction_id=uuid.uuid4(),
                subtotal=subtotal,
                discount=discount,
                total=total,
                amount_received=total + (Decimal("100") if index % 4 == 0 else Decimal("0")),
                synced_offline=index % 9 == 0,
                synced_at=created_at + timedelta(hours=2) if index % 9 == 0 else None,
                created_at=created_at,
                updated_at=created_at,
            )
            sale.items.append(
                SaleItem(
                    organization_id=organization.id,
                    variant_id=variant.id,
                    product_name=variant.product.name,
                    variant_name=variant.name,
                    sku=variant.sku,
                    quantity=quantity,
                    unit_price=variant.price,
                    unit_cost=variant.cost,
                    line_total=subtotal,
                )
            )
            sale.payments.append(
                Payment(
                    organization_id=organization.id,
                    method=payment_methods[index % len(payment_methods)],
                    amount=total,
                    created_at=created_at,
                )
            )
            session.add(sale)
            movement = await inventory.apply_movement(
                variant_id=variant.id,
                quantity_delta=-quantity,
                movement_type="SALE",
                note=f"Demo sale {sale.invoice_number}",
                reference_type="sale",
                reference_id=sale.id,
            )
            movement.created_at = created_at
            if index % 23 == 0:
                returned = Return(
                    id=uuid.uuid4(),
                    organization_id=organization.id,
                    branch_id=branch.id,
                    sale_id=sale.id,
                    status="RECEIVED",
                    reason="Customer changed their mind",
                    created_at=created_at + timedelta(days=2),
                    updated_at=created_at + timedelta(days=2),
                )
                session.add(returned)
                session.add(
                    ReturnItem(
                        organization_id=organization.id,
                        return_id=returned.id,
                        variant_id=variant.id,
                        quantity=1,
                        disposition="SELLABLE",
                    )
                )
                movement = await inventory.apply_movement(
                    variant_id=variant.id,
                    quantity_delta=1,
                    movement_type="RETURN_SELLABLE",
                    note="Demo POS return",
                    reference_type="return",
                    reference_id=returned.id,
                )
                movement.created_at = returned.created_at

        final_stock = [3, 0, 7, 34, 18, 61, 12, 27, 44, 9, 73, 120, 6, 86]
        for variant, target in zip(variants, final_stock, strict=True):
            current = await inventory.item(variant.id)
            if current.physical_quantity != target:
                await inventory.apply_movement(
                    variant_id=variant.id,
                    quantity_delta=target - current.physical_quantity,
                    movement_type="MANUAL_ADJUSTMENT",
                    note="Demo cycle count",
                )

        for index in range(24):
            entity_type = "sale" if index % 2 == 0 else "order"
            session.add(
                AuditLog(
                    organization_id=organization.id,
                    user_id=staff[index % len(staff)].id,
                    action=f"{entity_type}.demo_reviewed",
                    entity_type=entity_type,
                    entity_id=None,
                    old_data=None,
                    new_data={"source": "demo seed", "sequence": index + 1},
                    request_id=f"seed-{index + 1:03d}",
                    ip_address="127.0.0.1",
                    user_agent="RetailOps demo seed",
                    created_at=when(index % 14, 15),
                )
            )
        session.add_all(
            [
                Notification(
                    organization_id=organization.id,
                    kind="LOW_STOCK",
                    title="Stock needs attention",
                    message="Three fast-moving variants are at or below their reorder level.",
                    entity_type="inventory",
                    created_at=when(0, 9),
                ),
                Notification(
                    organization_id=organization.id,
                    kind="ORDER_ATTENTION",
                    title="COD orders awaiting confirmation",
                    message="Review recent social orders and their explainable risk scores.",
                    entity_type="order",
                    created_at=when(0, 10),
                ),
            ]
        )

        await session.commit()
        print(
            f"Seeded RetailOps demo: {len(variants)} variants, {len(customers)} customers, "
            f"320 orders and 90 sales. Login: owner@demo.local / {PASSWORD}"
        )


if __name__ == "__main__":
    # psycopg's async Windows transport requires the selector event loop.
    with asyncio.Runner(loop_factory=asyncio.SelectorEventLoop) as runner:
        runner.run(seed())
