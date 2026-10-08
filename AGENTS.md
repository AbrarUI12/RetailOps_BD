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

### Sessions 3–27 — draft received, being completed phase by phase

Sessions 3–27 arrived as an uncommitted, unverified draft. A plan.md audit (2026-10-09) found missing endpoints, fake or missing UI, UI/UX below plan §7/§80 (7–10px text, raw hex colors), broken offline reload, and security holes.

The draft is now committed (`b7e932a`…`bd0967d`) and is being finished in the phases below. Do not treat a session as done until its phase is ticked here.

| Phase | Scope | State |
| --- | --- | --- |
| 0 | Checkpoint commits; free Render deploy with the in-API scheduler (`app/core/scheduler.py`, `APP_RUN_SCHEDULER`) | ✅ |
| 1 | Correctness and security: online sales can't bypass stock; SPLIT payments with applied amounts plus `sales.amount_received`; offline sales keep their time and paid prices (`PRICE_MISMATCH` conflict); transition permissions; reservations through `InventoryService`; returns limited to sold − returned, closing the order (`services/returns_service.py`); tenant checks; JSON-safe audit with request ID/IP/UA; one error envelope; access logs; per-org purchase reference; offline-safe auth cache and single-flight refresh; service worker no longer caches `/health` | ✅ |
| 2 | Design-system rework: type scale (nothing under 12px), tokens, a11y, Toast/Confirm/DataState/ResponsiveTable/Drawer/AnimatedNumber/SegmentedControl, `lib/format.ts` | ☐ |
| 3 | App shell, RBAC nav, real badges, notification bell, command palette search, auth hardening | ☐ |
| 4 | Categories, product/variant editing, inventory adjust/history UI | ☐ |
| 5 | POS scanning/shortcuts/checkout sheet, receipts, sales list, refunds | ☐ |
| 6 | Dashboard and reports to §12/§48 | ☐ |
| 7 | Customers profile, fast order form, order drawer, risk card, courier and returns UI | ☐ |
| 8 | Offline completeness (local stock, catalog sync, Sync Center actions, IndexedDB namespacing), PWA, Playwright | ☐ |
| 9 | Suppliers, purchases, audit log, notifications | ☐ |
| 10 | Security, performance and accessibility pass | ☐ |
| 11 | Demo seed per §67 | ☐ |
| 12 | Deploy (needs the account owner) | ☐ |
| 13 | Portfolio media | ☐ |

The full plan with per-phase detail lives in the session plan. The audit findings that still apply are listed under each phase above.

**Verification after Phase 1:** 57 backend tests on SQLite and PostgreSQL 17.6; 15 frontend tests; ruff, mypy, eslint, tsc and the build clean. Migrations round-trip with no drift, and the `24342a02ae64` payment backfill was checked both ways.

### Deployment groundwork (Session 27)

- `render.yaml` defines four free services: static site, Docker API (which runs the housekeeping scheduler in-process), Key Value and Postgres 17. It validates against Render's JSON schema.
- The static site proxies `/api/*` and `/health/*` to the API. This keeps the refresh cookie first-party: `onrender.com` is a public suffix, so the two subdomains are cross-site.
- The API boots via `backend/scripts/start_api.sh`: migrate → optional demo seed (`APP_SEED_DEMO`) → uvicorn with proxy headers.
- CI runs a PostgreSQL job (migration round-trip, idempotent seed, full suite) and a production image build.
- `backend/scripts/smoke_test.py` is the post-deploy check. Runbook: `docs/deployment.md`.

## Next

Phase 2: the design-system rework. Every later screen builds on it.
