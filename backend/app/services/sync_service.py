import uuid
from datetime import UTC, datetime

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
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
from app.schemas.operations import (
    ConflictResolutionInput,
    SyncConflictView,
    SyncResult,
    SyncSaleInput,
)
from app.schemas.sales import OfflineSalePayload
from app.services.audit_service import add_audit
from app.services.sales_service import SalesService


class SyncService:
    def __init__(self, session: AsyncSession, user: User) -> None:
        self.session = session
        self.user = user

    async def sync_sale(self, command: SyncSaleInput) -> SyncResult:
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
        canonical_payload = sale_command.model_dump(
            mode="json", exclude={"client_transaction_id"}, exclude_none=False
        )
        existing = await self._transaction(command.client_transaction_id)
        if existing:
            if existing.payload not in (command.payload, canonical_payload):
                raise AppError(
                    "IDEMPOTENCY_KEY_REUSED",
                    "This transaction ID is already bound to a different sale payload",
                    status_code=409,
                )
            if existing.status in {SyncStatus.SYNCED, SyncStatus.CONFLICT}:
                return self._result(existing, replay=True)
            if existing.status == SyncStatus.SYNCING:
                raise AppError(
                    "SYNC_IN_PROGRESS",
                    "This transaction is already being processed; retry shortly",
                    status_code=409,
                ) from None
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
            payload=canonical_payload,
            status=SyncStatus.SYNCING,
            server_record_id=None,
            error=None,
        )
        transaction.status = SyncStatus.SYNCING
        self.session.add(transaction)
        try:
            await self.session.commit()
        except IntegrityError:
            # Another request claimed this organization-scoped UUID between our SELECT and INSERT.
            await self.session.rollback()
            winner = await self._transaction(command.client_transaction_id)
            if winner and winner.payload in (command.payload, canonical_payload):
                if winner.status in {SyncStatus.SYNCED, SyncStatus.CONFLICT}:
                    return self._result(winner, replay=True)
                raise AppError(
                    "SYNC_IN_PROGRESS",
                    "This transaction is already being processed; retry shortly",
                    status_code=409,
                ) from None
            raise AppError(
                "IDEMPOTENCY_KEY_REUSED",
                "This transaction ID is already bound to a different sale payload",
                status_code=409,
            ) from None
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

    async def status(self, client_transaction_id: uuid.UUID) -> SyncResult:
        transaction = await self._transaction(client_transaction_id)
        if transaction is None:
            raise AppError(
                "SYNC_TRANSACTION_NOT_FOUND",
                "Sync transaction was not found",
                status_code=404,
            )
        return self._result(transaction, replay=False)

    async def _transaction(self, client_transaction_id: uuid.UUID) -> SyncTransaction | None:
        return await self.session.scalar(
            select(SyncTransaction).where(
                SyncTransaction.organization_id == self.user.organization_id,
                SyncTransaction.client_transaction_id == client_transaction_id,
            )
        )

    @staticmethod
    def _result(transaction: SyncTransaction, *, replay: bool) -> SyncResult:
        return SyncResult(
            client_transaction_id=transaction.client_transaction_id,
            status=transaction.status.value,
            server_record_id=transaction.server_record_id,
            idempotent_replay=replay,
            conflict=transaction.status == SyncStatus.CONFLICT,
        )

    async def conflicts(self) -> list[SyncConflictView]:
        rows = await self.session.scalars(
            select(SyncConflict)
            .where(SyncConflict.organization_id == self.user.organization_id)
            .order_by(SyncConflict.created_at.desc())
        )
        return [self._conflict_view(row) for row in rows]

    async def resolve_conflict(
        self, conflict_id: uuid.UUID, command: ConflictResolutionInput
    ) -> SyncConflictView:
        conflict = await self.session.scalar(
            select(SyncConflict)
            .where(
                SyncConflict.id == conflict_id,
                SyncConflict.organization_id == self.user.organization_id,
            )
            .with_for_update()
        )
        if conflict is None:
            raise AppError(
                "SYNC_CONFLICT_NOT_FOUND", "Sync conflict was not found", status_code=404
            )
        if conflict.reviewed_at is not None:
            if (
                conflict.resolution == command.resolution
                and conflict.resolution_note == command.note
            ):
                return self._conflict_view(conflict)
            raise AppError(
                "SYNC_CONFLICT_ALREADY_RESOLVED",
                "This conflict has already been resolved",
                status_code=409,
            )
        conflict.reviewed_at = datetime.now(UTC)
        conflict.reviewed_by = self.user.id
        conflict.resolution = command.resolution
        conflict.resolution_note = command.note
        add_audit(
            self.session,
            self.user,
            "sync_conflict.resolved",
            "sync_conflict",
            conflict.id,
            new_data={"resolution": command.resolution, "note": command.note},
        )
        await self.session.commit()
        return self._conflict_view(conflict)

    @staticmethod
    def _conflict_view(conflict: SyncConflict) -> SyncConflictView:
        return SyncConflictView(
            id=conflict.id,
            sync_transaction_id=conflict.sync_transaction_id,
            type=conflict.conflict_type,
            details=conflict.details,
            created_at=conflict.created_at,
            reviewed=conflict.reviewed_at is not None,
            reviewed_at=conflict.reviewed_at,
            reviewed_by=conflict.reviewed_by,
            resolution=conflict.resolution,
            resolution_note=conflict.resolution_note,
        )
