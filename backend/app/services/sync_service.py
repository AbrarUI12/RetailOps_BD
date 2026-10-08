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
from app.schemas.sales import CreateSaleRequest
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
            sale_command = CreateSaleRequest.model_validate(
                {
                    **command.payload,
                    "client_transaction_id": command.client_transaction_id,
                    "allow_inventory_conflict": True,
                }
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
        self.session.add(transaction)
        await self.session.commit()
        try:
            sale = await SalesService(self.session, self.user).create(
                sale_command, synced_offline=True
            )
        except AppError as exc:
            await self.session.rollback()
            transaction.status = SyncStatus.FAILED
            transaction.error = f"{exc.code}: {exc.message}"
            await self.session.commit()
            raise
        transaction.server_record_id = sale.id
        transaction.status = SyncStatus.CONFLICT if sale.inventory_conflict else SyncStatus.SYNCED
        if sale.inventory_conflict:
            self.session.add(
                SyncConflict(
                    organization_id=self.user.organization_id,
                    sync_transaction_id=transaction.id,
                    conflict_type="INVENTORY_OVERSELL",
                    details={"sale_id": str(sale.id), "invoice_number": sale.invoice_number},
                )
            )
            self.session.add(
                Notification(
                    organization_id=self.user.organization_id,
                    user_id=None,
                    kind="SYNC_CONFLICT",
                    title="Offline inventory conflict",
                    message=f"{sale.invoice_number} sold beyond recorded stock.",
                    entity_type="sale",
                    entity_id=sale.id,
                )
            )
        await self.session.commit()
        return SyncResult(
            client_transaction_id=command.client_transaction_id,
            status=transaction.status.value,
            server_record_id=sale.id,
            conflict=sale.inventory_conflict,
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
