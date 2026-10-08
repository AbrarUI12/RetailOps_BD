import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import AuditLog, User


def add_audit(
    session: AsyncSession,
    user: User,
    action: str,
    entity_type: str,
    entity_id: uuid.UUID | None,
    *,
    old_data: dict[str, Any] | None = None,
    new_data: dict[str, Any] | None = None,
) -> None:
    session.add(
        AuditLog(
            organization_id=user.organization_id,
            user_id=user.id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            old_data=old_data,
            new_data=new_data,
        )
    )
