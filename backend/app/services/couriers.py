"""Courier adapters. Order logic only sees these normalized types, never a provider's payloads."""

import uuid
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from app.core.exceptions import AppError
from app.models.entities import Order, OrderStatus


class CourierStatus(StrEnum):
    CREATED = "CREATED"
    PICKED_UP = "PICKED_UP"
    IN_TRANSIT = "IN_TRANSIT"
    DELIVERED = "DELIVERED"
    RETURNED = "RETURNED"
    CANCELLED = "CANCELLED"


# Order status implied by a courier update; statuses absent here only add to the timeline.
ORDER_STATUS_FOR: dict[CourierStatus, OrderStatus] = {
    CourierStatus.PICKED_UP: OrderStatus.SHIPPED,
    CourierStatus.DELIVERED: OrderStatus.DELIVERED,
    CourierStatus.RETURNED: OrderStatus.FAILED_DELIVERY,
}


@dataclass(frozen=True)
class CourierBooking:
    tracking_code: str
    status: CourierStatus


class CourierProvider(Protocol):
    name: str

    async def create_shipment(self, order: Order) -> CourierBooking: ...

    async def cancel_shipment(self, tracking_code: str) -> None: ...


class MockCourierProvider:
    """Deterministic stand-in for Steadfast/Pathao/RedX; status changes arrive as updates."""

    name = "MOCK_COURIER"

    async def create_shipment(self, order: Order) -> CourierBooking:
        return CourierBooking(
            tracking_code=f"RBD{uuid.uuid4().hex[:10].upper()}", status=CourierStatus.CREATED
        )

    async def cancel_shipment(self, tracking_code: str) -> None:
        return None


PROVIDERS: dict[str, CourierProvider] = {MockCourierProvider.name: MockCourierProvider()}
DEFAULT_PROVIDER = MockCourierProvider.name


def get_provider(name: str = DEFAULT_PROVIDER) -> CourierProvider:
    try:
        return PROVIDERS[name]
    except KeyError as exc:
        raise AppError(
            "UNKNOWN_COURIER", f"Courier {name} is not configured", status_code=422
        ) from exc
