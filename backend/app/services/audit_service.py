import uuid
from typing import Any

from fastapi.encoders import jsonable_encoder
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.request_context import current_request
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
    request = current_request()
    session.add(
        AuditLog(
            organization_id=user.organization_id,
            user_id=user.id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            # UUIDs, Decimals and datetimes become JSON-safe strings.
            old_data=jsonable_encoder(old_data) if old_data is not None else None,
            new_data=jsonable_encoder(new_data) if new_data is not None else None,
            request_id=request.request_id,
            ip_address=request.client_ip,
            user_agent=request.user_agent,
        )
    )
