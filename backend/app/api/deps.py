import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Annotated

import jwt
from fastapi import Depends, Request
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.exceptions import AppError
from app.core.permissions import ROLE_PERMISSIONS
from app.core.security import decode_access_token
from app.models.entities import User
from app.services.auth_service import session_is_live
from app.services.health_service import HealthService

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


def get_health_service() -> HealthService:
    return HealthService()


async def session_dependency() -> AsyncIterator[AsyncSession]:
    async for session in get_session():
        yield session


SessionDep = Annotated[AsyncSession, Depends(session_dependency)]


async def get_current_user(
    request: Request, session: SessionDep, token: Annotated[str, Depends(oauth2_scheme)]
) -> User:
    try:
        payload = decode_access_token(token)
        user_id = uuid.UUID(payload["sub"])
        organization_id = uuid.UUID(payload["organization_id"])
        session_id = uuid.UUID(payload["session_id"])
    except (jwt.InvalidTokenError, KeyError, ValueError) as exc:
        raise AppError(
            "INVALID_ACCESS_TOKEN", "Authentication is required", status_code=401
        ) from exc
    user = await session.scalar(
        select(User).where(
            User.id == user_id,
            User.organization_id == organization_id,
            User.is_active.is_(True),
        )
    )
    if user is None or not await session_is_live(session, session_id, user_id):
        raise AppError("INVALID_ACCESS_TOKEN", "Authentication is required", status_code=401)
    request.state.session_id = session_id
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def ensure_permission(user: User, permission: str) -> None:
    if permission not in ROLE_PERMISSIONS[user.role.name]:
        raise AppError(
            "FORBIDDEN",
            "You do not have permission to perform this action",
            status_code=403,
        )


def require_permission(permission: str) -> Callable[[CurrentUser], Awaitable[User]]:
    async def dependency(user: CurrentUser) -> User:
        ensure_permission(user, permission)
        return user

    return dependency
