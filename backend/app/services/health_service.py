import asyncio
from collections.abc import Awaitable, Callable
from typing import Literal, cast

import structlog
from sqlalchemy import text

from app.core.database import engine
from app.core.redis import redis_client
from app.schemas.health import DependencyChecks, ReadyHealth

logger = structlog.get_logger()
Check = Callable[[], Awaitable[None]]


async def check_database() -> None:
    async with engine.connect() as connection:
        await connection.execute(text("SELECT 1"))


async def check_redis() -> None:
    await cast(Awaitable[bool], redis_client.ping())


class HealthService:
    def __init__(
        self, database_check: Check = check_database, redis_check: Check = check_redis
    ) -> None:
        self.database_check = database_check
        self.redis_check = redis_check

    async def readiness(self) -> ReadyHealth:
        results = await asyncio.gather(
            self._run_check("database", self.database_check),
            self._run_check("redis", self.redis_check),
        )
        checks = DependencyChecks(database=results[0], redis=results[1])
        status = "ready" if all(result == "ok" for result in results) else "not_ready"
        return ReadyHealth(status=status, checks=checks)

    async def _run_check(self, name: str, check: Check) -> Literal["ok", "unavailable"]:
        try:
            await asyncio.wait_for(check(), timeout=2.0)
        except Exception as exc:
            logger.warning("health.check_failed", dependency=name, error_type=type(exc).__name__)
            return "unavailable"
        return "ok"
