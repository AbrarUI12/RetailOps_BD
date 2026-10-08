import asyncio
from collections.abc import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import get_settings
from app.services.housekeeping_service import (
    generate_low_stock_alerts,
    release_stale_sync_transactions,
)
from app.tasks.celery_app import celery_app


def _run(job: Callable[[AsyncSession], Awaitable[int]]) -> int:
    async def runner() -> int:
        # Each task gets its own event loop, so it must not reuse the API's pooled engine.
        engine = create_async_engine(get_settings().database_url, poolclass=NullPool)
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as session:
                return await job(session)
        finally:
            await engine.dispose()

    return asyncio.run(runner())


@celery_app.task(name="inventory.low_stock_alerts")  # type: ignore[untyped-decorator]
def low_stock_alerts() -> int:
    return _run(generate_low_stock_alerts)


@celery_app.task(name="sync.release_stale_transactions")  # type: ignore[untyped-decorator]
def release_stale_transactions() -> int:
    return _run(release_stale_sync_transactions)
