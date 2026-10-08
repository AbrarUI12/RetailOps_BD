import asyncio
import os
import sys
from collections.abc import AsyncIterator
from typing import NamedTuple

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool, StaticPool

from app.api.deps import session_dependency
from app.core.database import Base
from app.core.middleware import login_attempts
from app.core.security import hash_password
from app.main import app
from app.models.entities import Branch, Organization, Role, User, UserRole


@pytest.fixture(scope="session")
def event_loop_policy() -> asyncio.AbstractEventLoopPolicy:
    # psycopg's async driver cannot run on Windows' default Proactor loop.
    if sys.platform == "win32":
        return asyncio.WindowsSelectorEventLoopPolicy()
    return asyncio.get_event_loop_policy()


@pytest.fixture(autouse=True)
def reset_login_rate_limit() -> None:
    login_attempts.clear()


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as test_client:
        yield test_client


class DatabaseHarness(NamedTuple):
    client: AsyncClient
    sessions: async_sessionmaker[AsyncSession]


@pytest.fixture
async def db_client() -> AsyncIterator[DatabaseHarness]:
    # CI also runs the suite against PostgreSQL to cover row locks, NUMERIC and enum behavior.
    database_url = os.environ.get("APP_TEST_DATABASE_URL")
    engine = (
        create_async_engine(database_url, poolclass=NullPool)
        if database_url
        else create_async_engine(
            "sqlite+aiosqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
    )
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
        await connection.run_sync(Base.metadata.create_all)
    async with sessions() as session:
        organization = Organization(name="Test Retail", slug="test-retail")
        session.add(organization)
        await session.flush()
        branch = Branch(
            organization_id=organization.id,
            name="Test Branch",
            code="TEST",
            address="Dhaka",
        )
        session.add(branch)
        roles = [
            Role(organization_id=organization.id, name=UserRole.OWNER),
            Role(organization_id=organization.id, name=UserRole.CASHIER),
        ]
        session.add_all(roles)
        await session.flush()
        session.add_all(
            [
                User(
                    organization_id=organization.id,
                    branch_id=branch.id,
                    role_id=roles[0].id,
                    email="owner@retailopsbd.com",
                    full_name="Owner User",
                    password_hash=hash_password("RetailOps123!"),
                ),
                User(
                    organization_id=organization.id,
                    branch_id=branch.id,
                    role_id=roles[1].id,
                    email="cashier@retailopsbd.com",
                    full_name="Cashier User",
                    password_hash=hash_password("RetailOps123!"),
                ),
            ]
        )
        await session.commit()

    async def test_session() -> AsyncIterator[AsyncSession]:
        async with sessions() as session:
            yield session

    app.dependency_overrides[session_dependency] = test_session
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as test_client:
        yield DatabaseHarness(test_client, sessions)
    app.dependency_overrides.pop(session_dependency, None)
    await engine.dispose()
