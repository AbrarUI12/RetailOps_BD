"""Per-request facts (request id, client IP, user agent) available to services and logs."""

from contextvars import ContextVar
from dataclasses import dataclass


@dataclass(frozen=True)
class RequestContext:
    request_id: str | None = None
    client_ip: str | None = None
    user_agent: str | None = None


_EMPTY = RequestContext()
_current: ContextVar[RequestContext | None] = ContextVar("request_context", default=None)


def set_request_context(context: RequestContext) -> None:
    _current.set(context)


def current_request() -> RequestContext:
    return _current.get() or _EMPTY
