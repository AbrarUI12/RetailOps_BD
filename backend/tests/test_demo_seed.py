import pytest
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models.entities import (
    Customer,
    InventoryBalance,
    InventoryMovement,
    Order,
    Organization,
    ProductVariant,
    Sale,
)
from app.schemas.auth import LoginRequest
from scripts import seed_demo


async def test_demo_seed_is_rich_ledger_consistent_and_idempotent() -> None:
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    original_factory = seed_demo.session_factory
    seed_demo.session_factory = sessions
    try:
        await seed_demo.seed()
        await seed_demo.seed()
        async with sessions() as session:
            counts = {
                "organizations": await session.scalar(
                    select(func.count()).select_from(Organization)
                ),
                "customers": await session.scalar(select(func.count()).select_from(Customer)),
                "orders": await session.scalar(select(func.count()).select_from(Order)),
                "sales": await session.scalar(select(func.count()).select_from(Sale)),
                "variants": await session.scalar(select(func.count()).select_from(ProductVariant)),
            }
            balances = dict(
                (
                    await session.execute(
                        select(InventoryBalance.variant_id, InventoryBalance.physical_quantity)
                    )
                ).all()
            )
            movement_totals = dict(
                (
                    await session.execute(
                        select(
                            InventoryMovement.variant_id,
                            func.sum(InventoryMovement.quantity_delta),
                        ).group_by(InventoryMovement.variant_id)
                    )
                ).all()
            )
    finally:
        seed_demo.session_factory = original_factory
        await engine.dispose()

    assert counts == {
        "organizations": 1,
        "customers": 120,
        "orders": 320,
        "sales": 90,
        "variants": 14,
    }
    assert balances == movement_totals
    assert {0, 3, 6, 7}.issubset(set(balances.values()))


def test_plan_defined_demo_email_is_accepted_without_weakening_normal_email_validation() -> None:
    assert (
        LoginRequest(email=" OWNER@DEMO.LOCAL ", password="RetailOps123!").email
        == "owner@demo.local"
    )
    assert (
        LoginRequest(email="owner@example.com", password="RetailOps123!").email
        == "owner@example.com"
    )
    with pytest.raises(ValidationError):
        LoginRequest(email="not-an-email", password="RetailOps123!")
