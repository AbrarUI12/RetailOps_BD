import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.exceptions import AppError
from app.core.permissions import ROLE_PERMISSIONS
from app.core.security import (
    create_access_token,
    generate_refresh_token,
    hash_refresh_token,
    verify_password,
)
from app.models.entities import RefreshSession, User
from app.schemas.auth import AuthResponse, UserView


class AuthService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.settings = get_settings()

    async def login(
        self, email: str, password: str, user_agent: str | None
    ) -> tuple[AuthResponse, str]:
        user = await self._find_user(email)
        if user is None or not user.is_active or not verify_password(password, user.password_hash):
            raise AppError("INVALID_CREDENTIALS", "Email or password is incorrect", status_code=401)
        return await self._create_session(user, user_agent)

    async def refresh(self, refresh_token: str, user_agent: str | None) -> tuple[AuthResponse, str]:
        now = datetime.now(UTC)
        token_hash = hash_refresh_token(refresh_token)
        refresh_session = await self.session.scalar(
            select(RefreshSession).where(RefreshSession.token_hash == token_hash).with_for_update()
        )
        if (
            refresh_session is None
            or refresh_session.revoked_at is not None
            or refresh_session.expires_at.replace(tzinfo=UTC) <= now
        ):
            raise AppError(
                "INVALID_REFRESH", "Refresh session is invalid or expired", status_code=401
            )

        refresh_session.revoked_at = now
        user = await self.session.get(User, refresh_session.user_id)
        if user is None or not user.is_active:
            raise AppError("INVALID_REFRESH", "User session is no longer active", status_code=401)
        return await self._create_session(user, user_agent, family_id=refresh_session.family_id)

    async def logout(self, refresh_token: str | None) -> None:
        if refresh_token:
            await self.session.execute(
                update(RefreshSession)
                .where(RefreshSession.token_hash == hash_refresh_token(refresh_token))
                .values(revoked_at=datetime.now(UTC))
            )
            await self.session.commit()

    async def _find_user(self, email: str) -> User | None:
        return await self.session.scalar(select(User).where(User.email == email.lower().strip()))

    async def _create_session(
        self, user: User, user_agent: str | None, family_id: uuid.UUID | None = None
    ) -> tuple[AuthResponse, str]:
        raw_token, token_hash = generate_refresh_token()
        refresh_session = RefreshSession(
            user_id=user.id,
            family_id=family_id or uuid.uuid4(),
            token_hash=token_hash,
            expires_at=datetime.now(UTC) + timedelta(days=self.settings.refresh_token_days),
            user_agent=user_agent,
        )
        self.session.add(refresh_session)
        await self.session.flush()
        access_token = create_access_token(
            user_id=user.id,
            organization_id=user.organization_id,
            session_id=refresh_session.id,
        )
        await self.session.commit()
        permissions = sorted(ROLE_PERMISSIONS[user.role.name])
        return (
            AuthResponse(
                access_token=access_token,
                expires_in=self.settings.access_token_minutes * 60,
                user=UserView(
                    id=user.id,
                    organization_id=user.organization_id,
                    branch_id=user.branch_id,
                    email=user.email,
                    full_name=user.full_name,
                    role=user.role.name.value,
                    permissions=permissions,
                ),
            ),
            raw_token,
        )


def user_view(user: User) -> UserView:
    return UserView(
        id=user.id,
        organization_id=user.organization_id,
        branch_id=user.branch_id,
        email=user.email,
        full_name=user.full_name,
        role=user.role.name.value,
        permissions=sorted(ROLE_PERMISSIONS[user.role.name]),
    )
