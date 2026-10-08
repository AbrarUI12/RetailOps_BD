"""Periodic maintenance run by the Celery worker; every function is safe to re-run."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import (
    InventoryBalance,
    Notification,
    Product,
    ProductVariant,
    SyncStatus,
    SyncTransaction,
)

STALE_SYNC_AFTER = timedelta(minutes=15)


async def generate_low_stock_alerts(session: AsyncSession) -> int:
    """Create one unread LOW_STOCK notification per variant at or below its reorder level."""
    rows = (
        await session.execute(
            select(InventoryBalance, ProductVariant, Product)
            .join(ProductVariant, ProductVariant.id == InventoryBalance.variant_id)
            .join(Product, Product.id == ProductVariant.product_id)
            .where(
                ProductVariant.is_active.is_(True),
                InventoryBalance.physical_quantity - InventoryBalance.reserved_quantity
                <= ProductVariant.reorder_level,
            )
        )
    ).all()
    if not rows:
        return 0
    already_alerted = set(
        await session.scalars(
            select(Notification.entity_id).where(
                Notification.kind == "LOW_STOCK",
                Notification.read_at.is_(None),
                Notification.entity_id.in_([variant.id for _, variant, _ in rows]),
            )
        )
    )
    created = 0
    for balance, variant, product in rows:
        if variant.id in already_alerted:
            continue
        session.add(
            Notification(
                organization_id=balance.organization_id,
                user_id=None,
                kind="LOW_STOCK",
                title="Low stock",
                message=(
                    f"{product.name} ({variant.name}) has {balance.available_quantity} "
                    f"available; reorder level is {variant.reorder_level}."
                ),
                entity_type="product_variant",
                entity_id=variant.id,
            )
        )
        created += 1
    await session.commit()
    return created


async def release_stale_sync_transactions(
    session: AsyncSession, *, now: datetime | None = None
) -> int:
    """Mark transactions stuck in SYNCING as FAILED so the device's retry can reprocess them.

    Replays stay safe: the sale itself is guarded by its client_transaction_id.
    """
    cutoff = (now or datetime.now(UTC)) - STALE_SYNC_AFTER
    result = await session.execute(
        update(SyncTransaction)
        .where(
            SyncTransaction.status == SyncStatus.SYNCING,
            SyncTransaction.updated_at < cutoff,
        )
        .values(status=SyncStatus.FAILED, error="Sync did not finish; retry required")
    )
    await session.commit()
    return int(getattr(result, "rowcount", 0) or 0)
