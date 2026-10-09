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
| 2 | Design-system rework: `styles/tokens.css` (type scale with nothing under 12px, 4px spacing, 8/12/16 radius, AA-contrast colors with `--brand` at 4.6:1 for white text), CSS split into base/components/shell/pages, focus rings and `:focus-within` on search fields, coarse-pointer touch targets. Primitives: Toast, ConfirmDialog, DataState, ResponsiveTable, Drawer, AnimatedNumber, SegmentedControl. `lib/format.ts` and the `t()` layer. Guardrail test blocks <12px text and raw hex; axe checks run in Vitest; `scripts/screenshots.mjs` handles visual QA. The Vite dev proxy makes the API same-origin | ✅ |
| 3 | **Shell:** navigation filtered by role permissions plus `RequirePermission` route guards; real badges from `GET /workspace/counts`; store and branch from `/auth/me`; notification bell (Radix popover, mark read, mark all read via `POST /notifications/read-all`, deep links); profile menu with sign out and sign out on all devices; mobile More sheet; offline banner; sync indicator with last-synced time; skip link; page transitions. Command palette searches products/barcodes, orders, customer phones, invoices and tracking codes (`GET /search`) with arrow keys. Login prefill only in dev or `VITE_DEMO_MODE`. **Auth:** refresh-token reuse revokes the family (30 s multi-tab grace); access tokens die with their family on logout; `POST /auth/logout-all`; login, failed login and logout audited | ✅ |
| 3b | **Session 3 completed against plan §33–§36:** access tokens carry role and permissions (the server still re-reads the user); minimum password policy (`password_problems`, mirrored in `lib/passwordPolicy.ts`); `POST /auth/forgot-password` (silent for unknown emails) and `/auth/reset-password` with hashed, 30-minute, one-time tokens (`password_reset_tokens`) that end all sessions; `POST /auth/change-password` keeps this device only; refresh sessions record IP; recovery endpoints are rate-limited; a "session expired" notice on sign-in; forgot/reset pages and change password in the profile menu. Reset links are written to the server log outside production until email ships (V2) | ✅ |
| 4 | **Sessions 4–5 completed.** Backend: categories CRUD (refuses to delete a category still in use); product create, edit and soft delete; `GET`/`POST /products/{id}/variants` and `PATCH /variants/{id}`; separate `DUPLICATE_SKU`/`DUPLICATE_BARCODE` errors with the field name; search across names, variant SKUs and barcodes; category, active and stock filters; per-variant branch `available_quantity`; `products.image_url`. Inventory is paginated and filterable, `GET /inventory/{variant_id}` returns the item plus its ledger (who and why), and adjustments take `counted_quantity` or `quantity_delta` with a reason code and a required note. UI: Products table with stock badges, price ranges, filters, pagination and row action menus; a one-screen product form (Basics, Pricing, Variants, Inventory defaults, Media) with the Color × Size variant generator; a product drawer with animated Details/Variants tabs, per-variant editing, add variant, and deactivate behind a confirm; a categories manager. Inventory table with an adjust dialog (count or delta, current → new → difference preview, reason, note, reserved-stock guard) and a movement-history drawer. Tests: duplicate SKU/barcode, a second-tenant isolation test, positive, negative and counted adjustments, ledger detail, filters; UI tests for list, drawer, create flow and adjustment | ✅ |
| 4b | **Session 5 audit fixes.** The demo seed records opening stock through `InventoryService.apply_movement`, so no code outside the service writes stock (checked by grep). `GET /inventory/low-stock` and the new `status=reorder` filter include out-of-stock items, and the Inventory page's "Needs reorder" filter matches the nav badge and low-stock alerts. New test proves balance = sum of ledger movements, with each movement's previous quantity chaining to the one before, across adjustments and a sale | ✅ |
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

**Verification after Session 5 fixes:** 82 backend tests and 55 frontend tests.

**Verification after Phase 4:** 80 backend tests (SQLite; CI runs PostgreSQL) and 55 frontend tests. Visual QA was done with Playwright against a seeded local API, and it caught three UI bugs that are now fixed (form left open after create, value-like placeholders, misaligned fields).

**Verification after Session 3 completion:** 6 new password tests and 4 new frontend tests on top of Phase 3. The local Docker stack was down, so the PostgreSQL run and migration round-trip are verified by CI for this commit.

**Verification after Phase 3:** 67 backend tests (SQLite and PostgreSQL) and 41 frontend tests.

**Verification after Phase 1:** 57 backend tests on SQLite and PostgreSQL 17.6; 15 frontend tests; ruff, mypy, eslint, tsc and the build clean. Migrations round-trip with no drift, and the `24342a02ae64` payment backfill was checked both ways.

### Deployment groundwork (Session 27)

- `render.yaml` defines four free services: static site, Docker API (which runs the housekeeping scheduler in-process), Key Value and Postgres 17. It validates against Render's JSON schema.
- The static site proxies `/api/*` and `/health/*` to the API. This keeps the refresh cookie first-party: `onrender.com` is a public suffix, so the two subdomains are cross-site.
- The API boots via `backend/scripts/start_api.sh`: migrate → optional demo seed (`APP_SEED_DEMO`) → uvicorn with proxy headers.
- CI runs a PostgreSQL job (migration round-trip, idempotent seed, full suite) and a production image build.
- `backend/scripts/smoke_test.py` is the post-deploy check. Runbook: `docs/deployment.md`.

## Next

Phase 5: POS scanning and shortcuts, the checkout sheet, receipts, the sales list and refunds (Sessions 6–9).
