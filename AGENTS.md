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
| 5a | **Session 6 completed (POS product cache, plan §39–40).** Backend: `GET /sync/catalog-version` (a real fingerprint of products, variants and categories; stock deliberately excluded), `GET /sync/catalog` (flat sellable variants with category and stock), `GET /sync/stock` (available quantity per variant), all authenticated. Frontend: Dexie v2 schema (`catalog` indexed by barcode, SKU and category; `categories`; `meta`; the old `products` table dropped, queued sales untouched). `lib/catalog.ts` downloads only when the version changes, refreshes stock separately, and clears a cache that belongs to another organization. The POS searches only the local catalog, every keystroke, offline too. Scanner Enter adds an exact barcode or SKU match, repeat scans increment, and fast back-to-back scans are never lost. F2 focuses scan; category pills are real; tiles show stock and block out-of-stock items while online; a status footer has a refresh. The POS page is split into `components/pos/` (CatalogPanel, CartPanel, Receipt). Bugs found and fixed: React Query paused local IndexedDB queries offline (now `networkMode: "always"`, with a regression test proven to fail without the fix); a scan race erased the next barcode; the F2 hint polluted the input's accessible name | ✅ |
| 5b | **Session 7 completed (cart and checkout, plan §13–14).** The cart store holds lines, an optional customer and the discount input (৳ or %). `lib/checkout.ts` does tested, paisa-exact arithmetic: subtotal, capped discount, quick-cash notes, tender rules mirroring the server (only cash gives change, SPLIT needs two or more lines, card/MFS can't exceed the total), and the payload. The cart panel animates row insert, remove and quantity changes, and totals count via `AnimatedNumber` (kept at final precision). The focused checkout sheet runs customer lookup by phone or name (disabled offline), then discount, then Cash/bKash/Nagad/Card/Split, then amount received with Exact/next-note buttons, then live change due, then complete. Shortcuts: F4 customer, F6 discount, F8 payment, F9 open/complete, Esc close, documented in an in-app dialog (`lib/shortcuts.ts`). An F9 pressed for an earlier sale can't auto-submit a new checkout. `SegmentedControl` now uses a CSS selected state, because a shared Motion indicator broke inside the sheet's transform. Toasts sit top-right on desktop so they don't cover bottom actions. Real-browser QA posted cash-with-change and split-with-10%-discount sales to the API, and both were accepted | ✅ |
| 5c | **Session 8 completed (online sale transaction, plan §37).** `SalesService` persists the sale aggregate atomically: invoice, snapshot line items, applied payment rows, tendered amount/change, stock balances, immutable `SALE` movements with the sale reference, and the audit entry commit together. Online checkout uses current server prices, tenant-checks the optional customer, rejects inactive or unavailable variants and never allows negative available stock. A service-level rollback boundary explicitly clears all staged writes when any later line fails. The POS posts one client transaction ID, keeps the cart open for permanent API errors, and only queues transient/lost-response failures for idempotent replay. Tests now inspect every persisted record and prove that a two-line sale failing after the first staged decrement leaves both balances unchanged and creates no sale, item, payment, sale movement or audit row | ✅ |
| 5d | **Session 9 completed (receipts, sale history and refunds, plan §47).** The post-checkout success screen has primary New Sale plus Print and View Sale actions. The reusable 80mm receipt includes organization/branch, invoice, Dhaka date/time, cashier, optional customer, snapshot items with quantity × unit price, subtotal, discount, total, split tender lines, received cash and change; print CSS excludes the application shell. `GET /pos/sales` is tenant-scoped, searchable and paginated; `GET /pos/sales/{id}` returns receipt-complete detail plus per-line returned quantity. `/sales` provides a responsive ledger, deep-linked View Sale drawer and exact reprint. `POST /pos/sales/{id}/refund` requires `sale:refund`, accepts partial quantities and SELLABLE/DAMAGED/MISSING dispositions, uses `ReturnsService`/`InventoryService`, prevents cumulative returns above sold quantity, and audits the return. Global search and sale notifications deep-link to the ledger | ✅ |
| 5 | **POS vertical slice complete:** scanning, shortcuts, checkout, atomic online sale, offline queue handoff, receipts, sales list and refunds | ✅ |
| 6a | **Session 10 completed (dashboard vertical slice, plan §12).** `GET /reports/dashboard` is one tenant-scoped aggregate with inclusive Dhaka business-date and organization-branch filters. It returns six KPIs, complete-day or daily revenue buckets, orders by source, top products, actionable low/out-of-stock items, deep-linked recent sales/orders, branches and courier success. The responsive dashboard has Today/7/30-day controls with a shared Motion indicator, branch selector, skeleton/content crossfade, restrained metric/chart entrances and reduced-motion handling. Cashiers now land on POS instead of a report they cannot access; Overview is consistently guarded by `report:read` in navigation, route and API | ✅ |
| 6 | **Dashboard complete; Session 23 report-suite gaps remain** (refund reporting, product margin, available inventory and full COD financial breakdown from §48) | ☐ |
| 7 | Customers profile, fast order form, order drawer, risk card, courier and returns UI | ☐ |
| 8 | Offline completeness (local stock, catalog sync, Sync Center actions, IndexedDB namespacing), PWA, Playwright | ☐ |
| 9 | Suppliers, purchases, audit log, notifications | ☐ |
| 10 | Security, performance and accessibility pass | ☐ |
| 11 | Demo seed per §67 | ☐ |
| 12 | Deploy (needs the account owner) | ☐ |
| 13 | Portfolio media | ☐ |

The full plan with per-phase detail lives in the session plan. The audit findings that still apply are listed under each phase above.

**Verification after Session 9:** 91 backend tests and 79 frontend tests. New API tests cover searchable receipt history, complete detail, partial restock, returned-quantity projection, over-return rejection, audit logging, cashier permission denial, and tenant isolation across list/detail/refund. New UI tests cover opening receipt detail, full receipt fields, browser reprint, partial refund payloads and permission-hidden refund controls. Ruff format/lint, mypy, ESLint, TypeScript and the production build pass. Docker Desktop is not installed/running at its standard system or per-user paths, so PostgreSQL and image verification are delegated to CI.

**Verification after Session 10:** 93 backend tests and 81 frontend tests. Dashboard API tests cover the aggregate fields, complete revenue buckets, daily range buckets and tenant-safe branch selection. UI tests cover KPIs, operational sections, deep links, timeframe/branch requests, reduced motion and axe. Real-browser QA at 1440×900, 900×1180 and 390×844 found no console errors or horizontal overflow; temporary screenshots and the isolated SQLite QA database were removed. Ruff format/lint, mypy, ESLint, TypeScript and the production build pass; PostgreSQL and image verification remain delegated to CI.

**Verification after Session 8:** 87 backend tests and 76 frontend tests. The new backend coverage verifies the complete persisted aggregate and rollback after a partially staged multi-line checkout; the new POS test verifies a server stock rejection remains online, visible and recoverable without clearing or offline-queueing the cart. Ruff format/lint, mypy, ESLint, TypeScript and the production build pass. PostgreSQL re-verification is delegated to CI because Docker Desktop was not running locally.

**Verification after Session 7:** 85 backend tests and 75 frontend tests, including a POS page integration test on real Dexie covering F4/F6/F8/F9/Esc, quick cash and change, split, percent discount, customer selection and underpayment.

**Verification after Session 6:** 85 backend tests and 65 frontend tests. The plan's Session 6 test (catalog still searchable with the API unavailable) runs against real Dexie via `fake-indexeddb` and in a real browser with Playwright offline mode.

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

Session 11: customer list/profile, normalized phone lookup, addresses and purchase history.
