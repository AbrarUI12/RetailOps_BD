import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import exists, select, update
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
from app.models.entities import Branch, Organization, RefreshSession, User
from app.schemas.auth import AuthResponse, UserView
from app.services.audit_service import add_audit

# Two tabs may refresh at the same moment; a token rotated this recently is treated as a race,
# not as theft.
REUSE_GRACE = timedelta(seconds=30)


class AuthService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.settings = get_settings()

    async def login(
        self, email: str, password: str, user_agent: str | None
    ) -> tuple[AuthResponse, str]:
        user = await self._find_user(email)
        if user is None or not user.is_active or not verify_password(password, user.password_hash):
            if user is not None:
                add_audit(self.session, user, "auth.login_failed", "user", user.id)
                await self.session.commit()
            raise AppError("INVALID_CREDENTIALS", "Email or password is incorrect", status_code=401)
        add_audit(self.session, user, "auth.login", "user", user.id)
        return await self._create_session(user, user_agent)

    async def refresh(self, refresh_token: str, user_agent: str | None) -> tuple[AuthResponse, str]:
        now = datetime.now(UTC)
        refresh_session = await self.session.scalar(
            select(RefreshSession)
            .where(RefreshSession.token_hash == hash_refresh_token(refresh_token))
            .with_for_update()
        )
        if refresh_session is None or _aware(refresh_session.expires_at) <= now:
            raise AppError(
                "INVALID_REFRESH", "Refresh session is invalid or expired", status_code=401
            )
        if refresh_session.revoked_at is not None:
            if now - _aware(refresh_session.revoked_at) > REUSE_GRACE:
                # A rotated token came back: assume theft and end every session in the chain.
                await self._revoke_family(refresh_session.family_id, now)
                user = await self.session.get(User, refresh_session.user_id)
                if user is not None:
                    add_audit(
                        self.session,
                        user,
                        "auth.refresh_reuse_detected",
                        "user",
                        user.id,
                        new_data={"family_id": refresh_session.family_id},
                    )
                await self.session.commit()
            raise AppError(
                "INVALID_REFRESH", "Refresh session is invalid or expired", status_code=401
            )

        refresh_session.revoked_at = now
        user = await self.session.get(User, refresh_session.user_id)
        if user is None or not user.is_active:
            raise AppError("INVALID_REFRESH", "User session is no longer active", status_code=401)
        return await self._create_session(user, user_agent, family_id=refresh_session.family_id)

    async def logout(self, refresh_token: str | None) -> None:
        if not refresh_token:
            return
        refresh_session = await self.session.scalar(
            select(RefreshSession).where(
                RefreshSession.token_hash == hash_refresh_token(refresh_token)
            )
        )
        if refresh_session is None:
            return
        await self._revoke_family(refresh_session.family_id, datetime.now(UTC))
        user = await self.session.get(User, refresh_session.user_id)
        if user is not None:
            add_audit(self.session, user, "auth.logout", "user", user.id)
        await self.session.commit()

    async def logout_everywhere(self, user: User) -> None:
        await self.session.execute(
            update(RefreshSession)
            .where(RefreshSession.user_id == user.id, RefreshSession.revoked_at.is_(None))
            .values(revoked_at=datetime.now(UTC))
        )
        add_audit(self.session, user, "auth.logout_all", "user", user.id)
        await self.session.commit()

    async def _revoke_family(self, family_id: uuid.UUID, now: datetime) -> None:
        await self.session.execute(
            update(RefreshSession)
            .where(RefreshSession.family_id == family_id, RefreshSession.revoked_at.is_(None))
            .values(revoked_at=now)
        )

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
            user_agent=(user_agent or "")[:300] or None,
        )
        self.session.add(refresh_session)
        await self.session.flush()
        access_token = create_access_token(
            user_id=user.id,
            organization_id=user.organization_id,
            session_id=refresh_session.id,
        )
        await self.session.commit()
        return (
            AuthResponse(
                access_token=access_token,
                expires_in=self.settings.access_token_minutes * 60,
                user=await user_view(self.session, user),
            ),
            raw_token,
        )


async def session_is_live(session: AsyncSession, session_id: uuid.UUID) -> bool:
    """An access token stays valid while its refresh family still has an unrevoked session, so
    rotation keeps working but logout (or reuse detection) cuts off issued access tokens too."""
    family = select(RefreshSession.family_id).where(RefreshSession.id == session_id)
    live = await session.scalar(
        select(
            exists().where(
                RefreshSession.family_id == family.scalar_subquery(),
                RefreshSession.revoked_at.is_(None),
                RefreshSession.expires_at > datetime.now(UTC),
            )
        )
    )
    return bool(live)


async def user_view(session: AsyncSession, user: User) -> UserView:
    organization = await session.get(Organization, user.organization_id)
    branch = await session.get(Branch, user.branch_id)
    return UserView(
        id=user.id,
        organization_id=user.organization_id,
        organization_name=organization.name if organization else "",
        branch_id=user.branch_id,
        branch_name=branch.name if branch else "",
        branch_address=branch.address if branch else None,
        email=user.email,
        full_name=user.full_name,
        role=user.role.name.value,
        permissions=sorted(ROLE_PERMISSIONS[user.role.name]),
    )


def _aware(moment: datetime) -> datetime:
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)
