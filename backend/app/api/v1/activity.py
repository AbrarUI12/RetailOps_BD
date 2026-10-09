import uuid
from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select

from app.api.deps import SessionDep, require_permission
from app.models.entities import AuditLog, User
from app.schemas.operations import AuditPage, AuditView, NotificationView
from app.services.notification_service import NotificationService
from app.utils.time import business_day_start

router = APIRouter(tags=["activity"])


@router.get("/audit", response_model=AuditPage)
async def audit_log(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("audit:read"))],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
    q: Annotated[str | None, Query(max_length=80)] = None,
    action: Annotated[str | None, Query(max_length=80)] = None,
    entity_type: Annotated[str | None, Query(max_length=40)] = None,
    actor_id: uuid.UUID | None = None,
    start: date | None = None,
    end: date | None = None,
) -> AuditPage:
    conditions = [AuditLog.organization_id == user.organization_id]
    if q and q.strip():
        term = f"%{q.strip()}%"
        conditions.append(
            or_(
                AuditLog.action.ilike(term),
                AuditLog.entity_type.ilike(term),
                User.full_name.ilike(term),
                User.email.ilike(term),
            )
        )
    if action:
        conditions.append(AuditLog.action == action)
    if entity_type:
        conditions.append(AuditLog.entity_type == entity_type)
    if actor_id:
        conditions.append(AuditLog.user_id == actor_id)
    if start:
        conditions.append(AuditLog.created_at >= business_day_start(start))
    if end:
        if start and end < start:
            from app.core.exceptions import AppError

            raise AppError("INVALID_DATE_RANGE", "End date is before start date", status_code=422)
        conditions.append(AuditLog.created_at < business_day_start(end + timedelta(days=1)))

    base = select(AuditLog, User.full_name, User.email).outerjoin(User, User.id == AuditLog.user_id)
    rows = await session.execute(
        base.where(*conditions)
        .order_by(AuditLog.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    total = await session.scalar(
        select(func.count(AuditLog.id))
        .outerjoin(User, User.id == AuditLog.user_id)
        .where(*conditions)
    )
    return AuditPage(
        items=[
            AuditView(
                id=audit.id,
                action=audit.action,
                entity_type=audit.entity_type,
                entity_id=audit.entity_id,
                user_id=audit.user_id,
                actor_name=actor_name,
                actor_email=actor_email,
                old_data=audit.old_data,
                new_data=audit.new_data,
                request_id=audit.request_id,
                ip_address=audit.ip_address,
                user_agent=audit.user_agent,
                created_at=audit.created_at,
            )
            for audit, actor_name, actor_email in rows.all()
        ],
        page=page,
        page_size=page_size,
        total=total or 0,
    )


@router.get("/notifications", response_model=list[NotificationView])
async def notifications(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("product:read"))],
    unread_only: bool = False,
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
) -> list[NotificationView]:
    return await NotificationService(session, user).list(limit=limit, unread_only=unread_only)


@router.post("/notifications/{notification_id}/read", response_model=NotificationView)
async def mark_notification_read(
    notification_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("product:read"))],
) -> NotificationView:
    return await NotificationService(session, user).mark_read(notification_id)
