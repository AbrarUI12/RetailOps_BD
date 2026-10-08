from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import get_settings
from app.core.database import close_database, session_factory
from app.core.exceptions import register_exception_handlers
from app.core.logging import configure_logging
from app.core.middleware import (
    LoginRateLimitMiddleware,
    SecurityHeadersMiddleware,
    TrustedHostExceptHealthMiddleware,
)
from app.core.redis import close_redis
from app.core.scheduler import Scheduler


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    scheduler = Scheduler(session_factory) if get_settings().run_scheduler else None
    if scheduler:
        scheduler.start()
    yield
    if scheduler:
        await scheduler.stop()
    await close_redis()
    await close_database()


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.debug)

    application = FastAPI(
        title="RetailOps BD API",
        description="Operational API for the RetailOps BD commerce platform.",
        version=settings.app_version,
        debug=settings.debug,
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.add_middleware(
        TrustedHostExceptHealthMiddleware, allowed_hosts=settings.allowed_hosts
    )
    application.add_middleware(LoginRateLimitMiddleware)
    application.add_middleware(SecurityHeadersMiddleware)
    register_exception_handlers(application)
    application.include_router(api_router)
    return application


app = create_app()
