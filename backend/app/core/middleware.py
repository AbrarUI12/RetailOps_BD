import re
import time
import uuid
from collections import defaultdict, deque
from collections.abc import Awaitable, Callable

import structlog
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import JSONResponse
from starlette.types import Receive, Scope, Send

from app.core.config import get_settings
from app.core.request_context import RequestContext, set_request_context

access_logger = structlog.get_logger("retailops.access")
SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{1,80}$")


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        supplied_request_id = request.headers.get("x-request-id", "")
        request_id = (
            supplied_request_id
            if SAFE_REQUEST_ID.fullmatch(supplied_request_id)
            else uuid.uuid4().hex
        )
        request.state.request_id = request_id
        client_ip = request.client.host if request.client else None
        set_request_context(
            RequestContext(
                request_id=request_id,
                client_ip=client_ip,
                user_agent=(request.headers.get("user-agent") or "")[:255] or None,
            )
        )
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id)
        started = time.perf_counter()
        response = await call_next(request)
        if not request.url.path.startswith("/health/"):
            access_logger.info(
                "http.request",
                method=request.method,
                path=request.url.path,
                status=response.status_code,
                duration_ms=round((time.perf_counter() - started) * 1000, 1),
                client_ip=client_ip,
            )
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if request.url.path.startswith("/api/v1/auth/"):
            response.headers["Cache-Control"] = "no-store"
        if get_settings().environment == "production":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


# Per-process sliding window keyed by client IP. Uvicorn must run with --proxy-headers
# behind a load balancer, otherwise every request shares the proxy's address.
login_attempts: dict[tuple[str, str], deque[float]] = defaultdict(deque)
RATE_LIMITED_PATHS = {
    "/api/v1/auth/login",
    "/api/v1/auth/forgot-password",
    "/api/v1/auth/reset-password",
}


class LoginRateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: object, limit: int = 10, window_seconds: int = 60) -> None:
        super().__init__(app)  # type: ignore[arg-type]
        self.limit = limit
        self.window_seconds = window_seconds
        self.attempts = login_attempts

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        if request.method == "POST" and request.url.path in RATE_LIMITED_PATHS:
            client = request.client.host if request.client else "unknown"
            key = (request.url.path, client)
            now = time.monotonic()
            attempts = self.attempts[key]
            while attempts and attempts[0] < now - self.window_seconds:
                attempts.popleft()
            if len(attempts) >= self.limit:
                return JSONResponse(
                    status_code=429,
                    content={
                        "error": {
                            "code": "RATE_LIMITED",
                            "message": "Too many attempts. Try again shortly.",
                            "details": {},
                        }
                    },
                    headers={"Retry-After": str(self.window_seconds)},
                )
            attempts.append(now)
        return await call_next(request)


class TrustedHostExceptHealthMiddleware(TrustedHostMiddleware):
    """Host allowlist that lets platform health probes through, whatever Host they send."""

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["path"].startswith("/health/"):
            await self.app(scope, receive, send)
            return
        await super().__call__(scope, receive, send)
