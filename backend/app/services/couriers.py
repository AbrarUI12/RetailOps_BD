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


COURIER_STATUS_RANK: dict[CourierStatus, int] = {
    CourierStatus.CREATED: 0,
    CourierStatus.PICKED_UP: 1,
    CourierStatus.IN_TRANSIT: 2,
    CourierStatus.DELIVERED: 3,
    CourierStatus.RETURNED: 3,
    CourierStatus.CANCELLED: 3,
}


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


@dataclass(frozen=True)
class CourierTracking:
    status: CourierStatus
    description: str


class CourierProvider(Protocol):
    name: str

    async def create_shipment(self, order: Order) -> CourierBooking: ...

    async def track_shipment(self, tracking_code: str) -> CourierTracking: ...

    async def cancel_shipment(self, tracking_code: str) -> None: ...


class MockCourierProvider:
    """Deterministic stand-in for Steadfast/Pathao/RedX; status changes arrive as updates."""

    name = "MOCK_COURIER"

    def __init__(self) -> None:
        self._statuses: dict[str, CourierStatus] = {}

    async def create_shipment(self, order: Order) -> CourierBooking:
        booking = CourierBooking(
            tracking_code=f"RBD{uuid.uuid4().hex[:10].upper()}", status=CourierStatus.CREATED
        )
        self._statuses[booking.tracking_code] = booking.status
        return booking

    async def track_shipment(self, tracking_code: str) -> CourierTracking:
        status = self._statuses.get(tracking_code, CourierStatus.CREATED)
        return CourierTracking(status=status, description=f"Mock courier reported {status.value}")

    async def cancel_shipment(self, tracking_code: str) -> None:
        self._statuses[tracking_code] = CourierStatus.CANCELLED


PROVIDERS: dict[str, CourierProvider] = {MockCourierProvider.name: MockCourierProvider()}
DEFAULT_PROVIDER = MockCourierProvider.name


def get_provider(name: str = DEFAULT_PROVIDER) -> CourierProvider:
    try:
        return PROVIDERS[name]
    except KeyError as exc:
        raise AppError(
            "UNKNOWN_COURIER", f"Courier {name} is not configured", status_code=422
        ) from exc
