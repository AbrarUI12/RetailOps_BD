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

from app.core.request_context import RequestContext, set_request_context

access_logger = structlog.get_logger("retailops.access")


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        request_id = request.headers.get("x-request-id", "")[:80] or uuid.uuid4().hex
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
        return response


# Per-process sliding window keyed by client IP. Uvicorn must run with --proxy-headers
# behind a load balancer, otherwise every request shares the proxy's address.
login_attempts: dict[str, deque[float]] = defaultdict(deque)


class LoginRateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: object, limit: int = 10, window_seconds: int = 60) -> None:
        super().__init__(app)  # type: ignore[arg-type]
        self.limit = limit
        self.window_seconds = window_seconds
        self.attempts = login_attempts

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        if request.method == "POST" and request.url.path == "/api/v1/auth/login":
            key = request.client.host if request.client else "unknown"
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
                            "message": "Too many login attempts. Try again shortly.",
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
