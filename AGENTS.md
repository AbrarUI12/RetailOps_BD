# RetailOps BD — Agent Handoff

This file is the living implementation record for contributors and coding agents. Update it whenever a roadmap milestone is completed or a material architecture decision changes.

## Product rules

- `plan.md` is the product and roadmap source of truth.
- Build vertical slices: UI → API → service → database → tests.
- PostgreSQL is authoritative; offline client state is optimistic until reconciliation.
- Inventory changes only through the inventory service and immutable ledger movements.
- Money uses `Decimal`/`NUMERIC(14,2)`; timestamps are UTC and displayed in `Asia/Dhaka`.
- Every business-owned record is organization-scoped.
- Preserve idempotency for offline writes through `client_transaction_id`.
- Keep routes thin, permissions server-enforced, and Motion purposeful/reduced-motion safe.

## Toolchain

- Python 3.13.16, uv 0.12.23
- Node 24.14.1, npm 11.11.0
- PostgreSQL 17.6, Redis 7.4.5, Celery 5.6
- Docker Desktop with WSL 2

## Completed

### Sessions 1–2 — Foundation and design system

- FastAPI, async SQLAlchemy, Redis, Celery, Alembic, health checks, Docker Compose, and CI.
- React/Vite/Tailwind shell with semantic tokens, local fonts, reusable controls, Motion primitives, responsive navigation, command palette, and explicit interface states.
- Commits: `8bbee37`, `48fb11d`.

### Sessions 3–26 — Transactional product surface

- **Core:** auth with rotating refresh cookie, RBAC with five roles, catalog and variants, inventory ledger, POS sales and receipts, and the live dashboard.
- **Customers and orders:** customers with BD phone normalization, manual/Facebook COD orders with explainable risk scoring, and the legal order state machine with reservations.
  - Confirm reserves stock, cancel releases it, and shipping consumes it as an `ORDER_FULFILLMENT` movement.
- **Courier adapter:** `services/couriers.py` defines a `CourierProvider` protocol and a mock provider. Normalized courier updates (`POST /orders/{id}/shipment/events`) record the shipment timeline and drive order status.
- **Returns:** every disposition writes a ledger entry; `SELLABLE` restocks.
- **Purchases:** receiving is row-locked and idempotent.
- **Offline:** IndexedDB sale queue and idempotent `/sync/sales`.
  - Oversells create a `sync_conflicts` row and a notification.
  - Malformed payloads return 422 `INVALID_SYNC_PAYLOAD`.
  - Server rejections mark the transaction `FAILED`.
- **Sync engine** (`frontend/src/lib/syncEngine.ts`): health probe, strict creation-order queue, transient vs permanent failure classification, exponential backoff, and recovery of `SYNCING` rows from dead tabs.
  - POS checkout falls back to the queue on a transient failure, reusing the same `client_transaction_id`.
- **Reports:** `/reports/summary` and `/reports/sales.csv` by Dhaka business day. The dashboard's "today" is the Dhaka day (fixed UTC+6 in `app/utils/time.py`).
- **Background jobs:** Celery beat runs low-stock alerts and stale-sync release (`services/housekeeping_service.py`).
- **Audit, notifications, PWA:** audit log, notifications, and a PWA shell. Routes are code-split; POS and Sync Center stay in the entry bundle for offline use.
- **Hardening:**
  - JWT claims are parsed to UUIDs.
  - The login rate limiter keys on the real client IP behind the proxy.
  - Production settings refuse weak secrets, debug mode, or insecure cookies.
  - The host allowlist exempts `/health/*`.
  - The seed writes opening stock to the ledger.
- **Verification (2026-10-09):**
  - 42 backend tests pass on both SQLite and PostgreSQL 17.6.
  - 12 frontend tests pass.
  - ruff, mypy, eslint, tsc and the build are clean.
  - The Alembic migration passes upgrade → `alembic check` (no drift) → downgrade → upgrade on a fresh database.

### Session 27 — Deployment (prepared, not yet applied)

- `render.yaml` defines four free services: static site, Docker API (which runs the housekeeping scheduler in-process), Key Value and Postgres 17. It validates against Render's JSON schema.
- The static site proxies `/api/*` and `/health/*` to the API. This keeps the refresh cookie first-party: `onrender.com` is a public suffix, so the two subdomains are cross-site.
- The API boots via `backend/scripts/start_api.sh`: migrate → optional demo seed (`APP_SEED_DEMO`) → uvicorn with proxy headers.
- CI adds a PostgreSQL job (migration round-trip, idempotent seed, full suite) and a production image build.
- `backend/scripts/smoke_test.py` is a stdlib-only post-deploy check. Its API checks were verified against a local server.
- Runbook: `docs/deployment.md`.

## Next

1. **Apply the Blueprint** on Render, which needs the account owner. Every service is on a free plan.
   - Confirm the assigned hostnames match `render.yaml`.
   - Run `python backend/scripts/smoke_test.py https://retailops-bd.onrender.com --demo`.
   - Confirm the wildcard rewrites to the external API URL behave as expected.
2. **Session 28 portfolio polish:** screenshots, Motion GIF/video, the 2–4 minute demo video, an API docs screenshot, and a test badge. The README, CI badge and Mermaid diagrams are done.
3. **Remaining product gaps:**
   - Playwright E2E for the plan §65 offline scenarios.
   - Shipment timeline and "book courier" action in the Orders UI. The UI still moves orders to `SHIPPED` directly.
   - Optimistic local stock display in POS. Variants carry no stock in the POS payload.
   - A service worker precache manifest for lazy route chunks.
   - Sentry.
   - A Redis-backed login rate limiter for multi-instance deployments.
