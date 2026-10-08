from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.models.entities import (
    Device,
    Notification,
    SyncConflict,
    SyncStatus,
    SyncTransaction,
    User,
)
from app.schemas.operations import SyncResult, SyncSaleInput
from app.schemas.sales import OfflineSalePayload
from app.services.sales_service import SalesService


class SyncService:
    def __init__(self, session: AsyncSession, user: User) -> None:
        self.session = session
        self.user = user

    async def sync_sale(self, command: SyncSaleInput) -> SyncResult:
        existing = await self.session.scalar(
            select(SyncTransaction).where(
                SyncTransaction.organization_id == self.user.organization_id,
                SyncTransaction.client_transaction_id == command.client_transaction_id,
            )
        )
        if existing and existing.status in {SyncStatus.SYNCED, SyncStatus.CONFLICT}:
            return SyncResult(
                client_transaction_id=command.client_transaction_id,
                status=existing.status.value,
                server_record_id=existing.server_record_id,
                idempotent_replay=True,
                conflict=existing.status == SyncStatus.CONFLICT,
            )
        try:
            sale_command = OfflineSalePayload.model_validate(
                {**command.payload, "client_transaction_id": command.client_transaction_id}
            )
        except ValidationError as exc:
            raise AppError(
                "INVALID_SYNC_PAYLOAD",
                "Offline sale payload is invalid",
                status_code=422,
                details={
                    "errors": exc.errors(
                        include_url=False, include_context=False, include_input=False
                    )
                },
            ) from exc
        device = await self.session.scalar(
            select(Device).where(
                Device.organization_id == self.user.organization_id,
                Device.device_key == command.device_key,
            )
        )
        if device is None:
            device = Device(
                organization_id=self.user.organization_id,
                branch_id=self.user.branch_id,
                name="Browser POS",
                device_key=command.device_key,
            )
            self.session.add(device)
            await self.session.flush()
        transaction = existing or SyncTransaction(
            organization_id=self.user.organization_id,
            device_id=device.id,
            client_transaction_id=command.client_transaction_id,
            transaction_type="SALE",
            payload=command.payload,
            status=SyncStatus.SYNCING,
            server_record_id=None,
            error=None,
        )
        transaction.status = SyncStatus.SYNCING
        self.session.add(transaction)
        await self.session.commit()
        try:
            outcome = await SalesService(self.session, self.user).create_offline(sale_command)
        except AppError as exc:
            await self.session.rollback()
            transaction.status = SyncStatus.FAILED
            transaction.error = f"{exc.code}: {exc.message}"
            await self.session.commit()
            raise
        sale = outcome.view
        conflicts: list[tuple[str, dict[str, object], str]] = []
        if outcome.oversold:
            conflicts.append(
                (
                    "INVENTORY_OVERSELL",
                    {"lines": outcome.oversold},
                    f"{sale.invoice_number} sold beyond recorded stock.",
                )
            )
        if outcome.price_mismatches:
            conflicts.append(
                (
                    "PRICE_MISMATCH",
                    {"lines": outcome.price_mismatches},
                    f"{sale.invoice_number} was sold offline at a price that has since changed.",
                )
            )
        for conflict_type, details, message in conflicts:
            self.session.add(
                SyncConflict(
                    organization_id=self.user.organization_id,
                    sync_transaction_id=transaction.id,
                    conflict_type=conflict_type,
                    details={
                        "sale_id": str(sale.id),
                        "invoice_number": sale.invoice_number,
                        **details,
                    },
                )
            )
            self.session.add(
                Notification(
                    organization_id=self.user.organization_id,
                    user_id=None,
                    kind="SYNC_CONFLICT",
                    title="Offline sale needs review",
                    message=message,
                    entity_type="sale",
                    entity_id=sale.id,
                )
            )
        transaction.server_record_id = sale.id
        transaction.status = SyncStatus.CONFLICT if conflicts else SyncStatus.SYNCED
        transaction.error = None
        await self.session.commit()
        return SyncResult(
            client_transaction_id=command.client_transaction_id,
            status=transaction.status.value,
            server_record_id=sale.id,
            idempotent_replay=sale.idempotent_replay,
            conflict=bool(conflicts),
        )

    async def conflicts(self) -> list[dict[str, object]]:
        rows = await self.session.scalars(
            select(SyncConflict)
            .where(SyncConflict.organization_id == self.user.organization_id)
            .order_by(SyncConflict.created_at.desc())
        )
        return [
            {
                "id": str(row.id),
                "type": row.conflict_type,
                "details": row.details,
                "created_at": row.created_at.isoformat(),
                "reviewed": row.reviewed_at is not None,
            }
            for row in rows
        ]
