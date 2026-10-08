"""Post-deploy smoke test. Standard library only, so it runs anywhere Python does.

Usage:
    python scripts/smoke_test.py https://retailops-bd.onrender.com [--demo]

The web URL is enough: the static site proxies /api and /health to the API on the same origin.
--demo also signs in with the seeded demo owner and reads the live dashboard.
"""

import argparse
import json
import sys
import urllib.error
import urllib.request
from email.message import Message
from http.cookiejar import CookieJar
from typing import Any

DEMO_LOGIN = {"email": "owner@retailopsbd.com", "password": "RetailOps123!"}


class Smoke:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.cookies = CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))
        self.failures = 0

    def request(
        self, path: str, *, body: dict[str, Any] | None = None, token: str | None = None
    ) -> tuple[int, Message, bytes]:
        headers = {"Accept": "application/json"}
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = urllib.request.Request(f"{self.base_url}{path}", data=data, headers=headers)
        try:
            with self.opener.open(request, timeout=60) as response:
                return response.status, response.headers, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.headers, error.read()

    def check(self, name: str, passed: bool, detail: str = "") -> None:
        self.failures += 0 if passed else 1
        print(f"{'PASS' if passed else 'FAIL'}  {name}{f' — {detail}' if detail else ''}")


def run(base_url: str, demo: bool) -> int:
    smoke = Smoke(base_url)
    if not base_url.startswith("https://"):
        smoke.check("served over HTTPS", False, base_url)

    status, headers, body = smoke.request("/")
    smoke.check("web app shell loads", status == 200 and b'id="root"' in body, f"HTTP {status}")
    smoke.check(
        "security headers on web app",
        headers.get("X-Content-Type-Options") == "nosniff"
        and headers.get("X-Frame-Options") == "DENY",
    )
    status, _, body = smoke.request("/dashboard")
    smoke.check("client routes rewrite to the app shell", status == 200 and b'id="root"' in body)

    status, headers, body = smoke.request("/health/ready")
    ready = json.loads(body) if status == 200 else {}
    smoke.check("API ready (database + redis)", ready.get("status") == "ready", body.decode()[:200])
    smoke.check("API sets request IDs", bool(headers.get("X-Request-ID")))

    status, _, body = smoke.request(
        "/api/v1/auth/login", body={**DEMO_LOGIN, "password": "not-the-password"}
    )
    smoke.check("bad credentials are rejected", status == 401, f"HTTP {status}")

    if demo:
        status, _, body = smoke.request("/api/v1/auth/login", body=DEMO_LOGIN)
        smoke.check("demo owner can sign in", status == 200, f"HTTP {status}")
        token = json.loads(body).get("access_token") if status == 200 else None
        has_refresh = any(cookie.name == "retailops_refresh" for cookie in smoke.cookies)
        smoke.check("refresh cookie is first-party", has_refresh)
        status, _, body = smoke.request("/api/v1/reports/dashboard", token=token)
        smoke.check("dashboard report loads", status == 200, f"HTTP {status}")
        status, _, body = smoke.request("/api/v1/products?page_size=5", token=token)
        products = json.loads(body).get("items", []) if status == 200 else []
        smoke.check("demo catalog is seeded", bool(products), f"{len(products)} products")
        if has_refresh:
            status, _, _ = smoke.request("/api/v1/auth/refresh", body={})
            smoke.check("refresh token rotation works", status == 200, f"HTTP {status}")

    print(f"\n{'Smoke test passed' if not smoke.failures else f'{smoke.failures} check(s) failed'}")
    return 1 if smoke.failures else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("base_url")
    parser.add_argument("--demo", action="store_true", help="also exercise the seeded demo tenant")
    arguments = parser.parse_args()
    sys.exit(run(arguments.base_url, arguments.demo))
