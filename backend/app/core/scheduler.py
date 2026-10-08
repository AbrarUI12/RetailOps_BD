"""In-process periodic jobs for single-instance deployments without a separate worker.

Celery beat remains the scheduler for local Compose; enable this with APP_RUN_SCHEDULER=true when
the API is the only process (Render free plan). Every job is idempotent, so a restart or an overlap
with a Celery run is harmless.
"""

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

import structlog
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.services.housekeeping_service import (
    generate_low_stock_alerts,
    release_stale_sync_transactions,
)

logger = structlog.get_logger(__name__)

Job = Callable[[AsyncSession], Awaitable[int]]


@dataclass
class ScheduledJob:
    name: str
    every_seconds: float
    run: Job
    next_run: float = field(default=0.0)


DEFAULT_JOBS = (
    ("sync.release_stale_transactions", 5 * 60, release_stale_sync_transactions),
    ("inventory.low_stock_alerts", 15 * 60, generate_low_stock_alerts),
)


class Scheduler:
    def __init__(
        self,
        sessions: async_sessionmaker[AsyncSession],
        jobs: tuple[tuple[str, float, Job], ...] = DEFAULT_JOBS,
        *,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.sessions = sessions
        self.clock = clock
        self.jobs = [ScheduledJob(name, every, run) for name, every, run in jobs]
        self._task: asyncio.Task[None] | None = None

    async def tick(self) -> list[str]:
        """Run every job that is due; returns the names that ran."""
        now = self.clock()
        ran: list[str] = []
        for job in self.jobs:
            if job.next_run > now:
                continue
            job.next_run = now + job.every_seconds
            try:
                async with self.sessions() as session:
                    affected = await job.run(session)
                logger.info("scheduler.job_finished", job=job.name, affected=affected)
            except Exception:
                logger.exception("scheduler.job_failed", job=job.name)
            ran.append(job.name)
        return ran

    async def _loop(self, poll_seconds: float) -> None:
        while True:
            await self.tick()
            await asyncio.sleep(poll_seconds)

    def start(self, poll_seconds: float = 30) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop(poll_seconds), name="scheduler")

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None
