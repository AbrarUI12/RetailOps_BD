import uuid
from datetime import UTC, datetime

from sqlalchemy import ColumnElement, and_, exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.models.entities import Notification, NotificationRead, User
from app.schemas.operations import NotificationView


class NotificationService:
    """Visible notification events with read state owned by the current user."""

    def __init__(self, session: AsyncSession, user: User) -> None:
        self.session = session
        self.user = user

    def visible(self) -> tuple[ColumnElement[bool], ...]:
        return (
            Notification.organization_id == self.user.organization_id,
            or_(Notification.user_id.is_(None), Notification.user_id == self.user.id),
        )

    def unread(self) -> tuple[ColumnElement[bool], ...]:
        receipt_exists = exists(
            select(NotificationRead.id)
            .where(
                NotificationRead.notification_id == Notification.id,
                NotificationRead.user_id == self.user.id,
            )
            .correlate(Notification)
        )
        return (*self.visible(), Notification.read_at.is_(None), ~receipt_exists)

    async def list(self, *, limit: int = 100, unread_only: bool = False) -> list[NotificationView]:
        conditions = self.unread() if unread_only else self.visible()
        rows = await self.session.execute(
            select(Notification, NotificationRead.read_at)
            .outerjoin(
                NotificationRead,
                and_(
                    NotificationRead.notification_id == Notification.id,
                    NotificationRead.user_id == self.user.id,
                ),
            )
            .where(*conditions)
            .order_by(Notification.created_at.desc())
            .limit(limit)
        )
        return [
            self._view(notification, receipt_read_at)
            for notification, receipt_read_at in rows.all()
        ]

    async def mark_read(self, notification_id: uuid.UUID) -> NotificationView:
        notification = await self.session.scalar(
            select(Notification).where(Notification.id == notification_id, *self.visible())
        )
        if notification is None:
            raise AppError("NOTIFICATION_NOT_FOUND", "Notification was not found", status_code=404)
        receipt = await self.session.scalar(
            select(NotificationRead).where(
                NotificationRead.notification_id == notification.id,
                NotificationRead.user_id == self.user.id,
            )
        )
        if receipt is None:
            receipt = NotificationRead(
                organization_id=self.user.organization_id,
                notification_id=notification.id,
                user_id=self.user.id,
                read_at=datetime.now(UTC),
            )
            self.session.add(receipt)
            await self.session.commit()
        return self._view(notification, receipt.read_at)

    async def mark_all_read(self) -> int:
        ids = list(await self.session.scalars(select(Notification.id).where(*self.unread())))
        now = datetime.now(UTC)
        self.session.add_all(
            [
                NotificationRead(
                    organization_id=self.user.organization_id,
                    notification_id=notification_id,
                    user_id=self.user.id,
                    read_at=now,
                )
                for notification_id in ids
            ]
        )
        await self.session.commit()
        return len(ids)

    @staticmethod
    def _view(notification: Notification, receipt_read_at: datetime | None) -> NotificationView:
        return NotificationView(
            id=notification.id,
            kind=notification.kind,
            title=notification.title,
            message=notification.message,
            read_at=receipt_read_at or notification.read_at,
            entity_type=notification.entity_type,
            entity_id=notification.entity_id,
            created_at=notification.created_at,
        )
