"""Create a deterministic, idempotent portfolio/demo tenant."""

import asyncio
from decimal import Decimal

from sqlalchemy import select

from app.core.database import session_factory
from app.core.permissions import ALL_PERMISSIONS, ROLE_PERMISSIONS
from app.core.security import hash_password
from app.models.entities import (
    Branch,
    Category,
    InventoryBalance,
    InventoryMovement,
    Organization,
    Permission,
    Product,
    ProductVariant,
    Role,
    User,
    UserRole,
)


async def seed() -> None:
    async with session_factory() as session:
        existing = await session.scalar(
            select(Organization).where(Organization.slug == "retailops-demo")
        )
        if existing:
            print("Demo tenant already exists; no changes made.")
            return

        organization = Organization(name="RetailOps BD Demo", slug="retailops-demo")
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

        password_hash = hash_password("RetailOps123!")
        users = [
            ("owner@retailopsbd.com", "Abrar Rahman", UserRole.OWNER),
            ("manager@retailopsbd.com", "Nusrat Jahan", UserRole.MANAGER),
            ("cashier@retailopsbd.com", "Tanvir Ahmed", UserRole.CASHIER),
            ("support@retailopsbd.com", "Sadia Islam", UserRole.SUPPORT),
            ("warehouse@retailopsbd.com", "Rafi Hasan", UserRole.WAREHOUSE),
        ]
        session.add_all(
            [
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
        )

        catalog = [
            ("Apparel", "Premium Panjabi", "PAN", "Classic / M", "PAN-M", "100001", 2490, 1320, 28),
            (
                "Apparel",
                "Linen Casual Shirt",
                "SHIRT",
                "Olive / L",
                "SHIRT-OL-L",
                "100002",
                1890,
                910,
                17,
            ),
            (
                "Accessories",
                "Leather Wallet",
                "WALLET",
                "Walnut",
                "WALLET-WN",
                "100003",
                1290,
                540,
                9,
            ),
            (
                "Home",
                "Nakshi Cushion Cover",
                "CUSHION",
                "Crimson",
                "CUSHION-CR",
                "100004",
                790,
                330,
                4,
            ),
            ("Beauty", "Botanical Face Wash", "FACE", "120 ml", "FACE-120", "100005", 650, 310, 36),
            (
                "Food",
                "Premium Tea Gift Box",
                "TEA",
                "6 blends",
                "TEA-GIFT",
                "100006",
                1490,
                760,
                13,
            ),
        ]
        categories: dict[str, Category] = {}
        for category_name, *_ in catalog:
            if category_name not in categories:
                category = Category(
                    organization_id=organization.id,
                    name=category_name,
                    slug=category_name.lower(),
                )
                categories[category_name] = category
                session.add(category)
        await session.flush()
        for (
            category_name,
            name,
            sku,
            variant_name,
            variant_sku,
            barcode,
            price,
            cost,
            stock,
        ) in catalog:
            product = Product(
                organization_id=organization.id,
                category_id=categories[category_name].id,
                name=name,
                sku=sku,
                description=f"Demo catalog item: {name}",
            )
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
            session.add(product)
            await session.flush()
            session.add(
                InventoryBalance(
                    organization_id=organization.id,
                    branch_id=branch.id,
                    variant_id=variant.id,
                    physical_quantity=stock,
                    reserved_quantity=0,
                )
            )
            session.add(
                InventoryMovement(
                    organization_id=organization.id,
                    branch_id=branch.id,
                    variant_id=variant.id,
                    movement_type="OPENING_STOCK",
                    quantity_delta=stock,
                    previous_quantity=0,
                    new_quantity=stock,
                    note="Demo opening stock",
                )
            )
        await session.commit()
        print("Seeded RetailOps BD demo. Login: owner@retailopsbd.com / RetailOps123!")


if __name__ == "__main__":
    # psycopg's async Windows transport requires the selector event loop.
    with asyncio.Runner(loop_factory=asyncio.SelectorEventLoop) as runner:
        runner.run(seed())
