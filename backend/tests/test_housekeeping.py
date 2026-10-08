import asyncio
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Notification, Organization, SyncStatus, SyncTransaction
from app.services.housekeeping_service import (
    generate_low_stock_alerts,
    release_stale_sync_transactions,
)
from tests.conftest import DatabaseHarness
from tests.test_operations_workflows import owner_headers, stocked_variant


async def test_low_stock_alert_is_created_once_per_variant(db_client: DatabaseHarness) -> None:
    headers = await owner_headers(db_client.client)
    await stocked_variant(db_client.client, headers, 2)  # default reorder level is 5
    await stocked_variant(db_client.client, headers, 50)

    async with db_client.sessions() as session:
        assert await generate_low_stock_alerts(session) == 1
        assert await generate_low_stock_alerts(session) == 0
        kinds = await session.scalars(select(Notification.kind))
        assert list(kinds) == ["LOW_STOCK"]


async def test_stale_syncing_transaction_is_released_for_retry(
    db_client: DatabaseHarness,
) -> None:
    async with db_client.sessions() as session:
        organization_id = await session.scalar(select(Organization.id))
        now = datetime.now(UTC)
        stale, fresh = (
            SyncTransaction(
                organization_id=organization_id,
                client_transaction_id=uuid.uuid4(),
                transaction_type="SALE",
                payload={},
                status=SyncStatus.SYNCING,
                updated_at=updated_at,
            )
            for updated_at in (now - timedelta(minutes=30), now)
        )
        session.add_all([stale, fresh])
        await session.commit()

        assert await release_stale_sync_transactions(session, now=now) == 1
        await session.refresh(stale)
        await session.refresh(fresh)
        assert stale.status == SyncStatus.FAILED
        assert fresh.status == SyncStatus.SYNCING


async def test_scheduler_runs_due_jobs_and_survives_failures(db_client: DatabaseHarness) -> None:
    from app.core.scheduler import Scheduler

    calls: list[str] = []

    async def ok(_: AsyncSession) -> int:
        calls.append("ok")
        return 1

    async def broken(_: AsyncSession) -> int:
        raise RuntimeError("boom")

    now = [1000.0]
    scheduler = Scheduler(
        db_client.sessions, (("ok", 60, ok), ("broken", 60, broken)), clock=lambda: now[0]
    )

    assert await scheduler.tick() == ["ok", "broken"]
    assert await scheduler.tick() == []
    now[0] += 61
    assert await scheduler.tick() == ["ok", "broken"]
    assert calls == ["ok", "ok"]


async def test_scheduler_default_jobs_run_against_database(db_client: DatabaseHarness) -> None:
    from app.core.scheduler import Scheduler

    scheduler = Scheduler(db_client.sessions)
    scheduler.start(poll_seconds=0.01)
    await asyncio.sleep(0.05)
    await scheduler.stop()

    assert all(job.next_run > 0 for job in scheduler.jobs)
