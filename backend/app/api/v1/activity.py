import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select

from app.api.deps import SessionDep, require_permission
from app.models.entities import AuditLog, Notification, User
from app.schemas.operations import AuditView, NotificationView

router = APIRouter(tags=["activity"])


@router.get("/audit", response_model=list[AuditView])
async def audit_log(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("audit:read"))],
) -> list[AuditView]:
    rows = await session.scalars(
        select(AuditLog)
        .where(AuditLog.organization_id == user.organization_id)
        .order_by(AuditLog.created_at.desc())
        .limit(250)
    )
    return [AuditView.model_validate(row) for row in rows]


@router.get("/notifications", response_model=list[NotificationView])
async def notifications(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("product:read"))],
) -> list[NotificationView]:
    rows = await session.scalars(
        select(Notification)
        .where(
            Notification.organization_id == user.organization_id,
            (Notification.user_id.is_(None)) | (Notification.user_id == user.id),
        )
        .order_by(Notification.created_at.desc())
        .limit(100)
    )
    return [NotificationView.model_validate(row) for row in rows]


@router.post("/notifications/{notification_id}/read", response_model=NotificationView)
async def mark_notification_read(
    notification_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("product:read"))],
) -> NotificationView:
    notification = await session.scalar(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.organization_id == user.organization_id,
        )
    )
    if notification is None:
        from app.core.exceptions import AppError

        raise AppError("NOTIFICATION_NOT_FOUND", "Notification was not found", status_code=404)
    notification.read_at = datetime.now(UTC)
    await session.commit()
    return NotificationView.model_validate(notification)
