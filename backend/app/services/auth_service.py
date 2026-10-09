import uuid
from datetime import UTC, datetime, timedelta

import structlog
from sqlalchemy import exists, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings, public_app_url
from app.core.exceptions import AppError
from app.core.permissions import ROLE_PERMISSIONS
from app.core.request_context import current_request
from app.core.security import (
    create_access_token,
    generate_refresh_token,
    generate_reset_token,
    hash_password,
    hash_refresh_token,
    password_problems,
    verify_password,
)
from app.models.entities import Branch, Organization, PasswordResetToken, RefreshSession, User
from app.schemas.auth import AuthResponse, UserView
from app.services.audit_service import add_audit

# Two tabs may refresh at the same moment; a token rotated this recently is treated as a race,
# not as theft.
REUSE_GRACE = timedelta(seconds=30)
logger = structlog.get_logger(__name__)


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

    async def forgot_password(self, email: str) -> None:
        """Issue a one-time reset link. Always succeeds silently so emails can't be enumerated."""
        user = await self._find_user(email)
        if user is None or not user.is_active:
            return
        now = datetime.now(UTC)
        await self.session.execute(
            update(PasswordResetToken)
            .where(PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None))
            .values(used_at=now)
        )
        token, token_hash = generate_reset_token()
        self.session.add(
            PasswordResetToken(
                user_id=user.id,
                token_hash=token_hash,
                expires_at=now + timedelta(minutes=self.settings.password_reset_minutes),
            )
        )
        add_audit(self.session, user, "auth.password_reset_requested", "user", user.id)
        await self.session.commit()
        deliver_password_reset(
            user, f"{public_app_url(self.settings)}/reset-password?token={token}"
        )

    async def reset_password(self, token: str, new_password: str) -> None:
        now = datetime.now(UTC)
        reset = await self.session.scalar(
            select(PasswordResetToken)
            .where(PasswordResetToken.token_hash == hash_refresh_token(token))
            .with_for_update()
        )
        if reset is None or reset.used_at is not None or _aware(reset.expires_at) <= now:
            raise AppError(
                "INVALID_RESET_TOKEN",
                "This reset link has expired or was already used. Request a new one.",
                status_code=400,
            )
        user = await self.session.get(User, reset.user_id)
        if user is None or not user.is_active:
            raise AppError(
                "INVALID_RESET_TOKEN", "This reset link is no longer valid", status_code=400
            )
        self._set_password(user, new_password)
        reset.used_at = now
        # A reset means the old password may be compromised: end every session.
        await self.session.execute(
            update(RefreshSession)
            .where(RefreshSession.user_id == user.id, RefreshSession.revoked_at.is_(None))
            .values(revoked_at=now)
        )
        add_audit(self.session, user, "auth.password_reset", "user", user.id)
        await self.session.commit()

    async def change_password(
        self, user: User, current_password: str, new_password: str, keep_session: uuid.UUID
    ) -> None:
        if not verify_password(current_password, user.password_hash):
            raise AppError(
                "INVALID_CREDENTIALS",
                "Current password is incorrect",
                status_code=400,
                details={"field": "current_password"},
            )
        self._set_password(user, new_password)
        keep_family = select(RefreshSession.family_id).where(RefreshSession.id == keep_session)
        await self.session.execute(
            update(RefreshSession)
            .where(
                RefreshSession.user_id == user.id,
                RefreshSession.revoked_at.is_(None),
                RefreshSession.family_id != keep_family.scalar_subquery(),
            )
            .values(revoked_at=datetime.now(UTC))
        )
        add_audit(self.session, user, "auth.password_changed", "user", user.id)
        await self.session.commit()

    @staticmethod
    def _set_password(user: User, password: str) -> None:
        problems = password_problems(password, email=user.email)
        if problems:
            raise AppError(
                "WEAK_PASSWORD",
                problems[0],
                status_code=422,
                details={"field": "new_password", "problems": problems},
            )
        user.password_hash = hash_password(password)

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
            ip_address=current_request().client_ip,
        )
        self.session.add(refresh_session)
        await self.session.flush()
        access_token = create_access_token(
            user_id=user.id,
            organization_id=user.organization_id,
            session_id=refresh_session.id,
            role=user.role.name.value,
            permissions=sorted(ROLE_PERMISSIONS[user.role.name]),
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


def deliver_password_reset(user: User, link: str) -> None:
    """Email delivery arrives in V2 (plan §78). Until then the link is written to the server log
    outside production, so local and demo environments can complete the flow."""
    if get_settings().environment == "production":
        logger.warning("password_reset.no_email_channel", user_id=str(user.id))
        return
    logger.info("password_reset.link", user_id=str(user.id), link=link)


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
