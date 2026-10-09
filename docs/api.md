# API

The OpenAPI schema and interactive docs are served at `/docs`. Business resources live under `/api/v1`. Health endpoints live at `/health/live` (process up) and `/health/ready` (database and Redis reachable).

## Conventions

- **Auth:** `Authorization: Bearer <access token>` (JWT, 15 minutes). The refresh token is an HttpOnly cookie on `/api/v1/auth`. It rotates on every refresh.
- **Errors** use one shape: `{"error": {"code": "INSUFFICIENT_STOCK", "message": "...", "details": {}}}`. Clients branch on `code`, never on `message`.
  - Validation failures use code `VALIDATION_ERROR`, with `details.fields` as a list of `{field, message}`.
  - Unknown routes return `HTTP_404`.
  - Unexpected failures return `INTERNAL_ERROR`, with the `request_id` to quote when reporting the problem.
- **Status codes:**
  - 401: unauthenticated
  - 403: missing permission
  - 404: not found, or not in your organization
  - 409: state conflict (illegal transition, insufficient stock)
  - 422: validation
  - 429: rate limited
- **Money** is a decimal string (`"1500.00"`).
- **Timestamps** are ISO 8601 UTC. Report `start`/`end` parameters are Dhaka calendar dates.

## Endpoints

| Area | Endpoint | Notes |
| --- | --- | --- |
| Auth | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/logout-all`, `GET /auth/me`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/change-password` | Login is rate-limited to 10 attempts per minute per client IP. Refresh tokens rotate, and reusing one revokes the whole session family. Logout invalidates access tokens already issued. Reset tokens are one-time, expire after 30 minutes, and end every session. Passwords need at least 10 characters mixing letters and numbers |
| Workspace | `GET /workspace/counts`, `GET /search?q=` | Badge counts and command-palette search, limited to what the role may open |
| Categories | `GET/POST /categories`, `PATCH/DELETE /categories/{id}` | A category still in use cannot be deleted |
| Products | `GET/POST /products?search&category_id&active&stock&page`, `GET/PATCH/DELETE /products/{id}`, `GET/POST /products/{id}/variants`, `PATCH /variants/{id}`, `GET /products/barcode/{barcode}` | `DELETE` deactivates rather than removes. Duplicates return `DUPLICATE_SKU` or `DUPLICATE_BARCODE`. Variants include `available_quantity` at your branch |
| Inventory | `GET /inventory?search&status=low|out|reorder|in_stock&category_id&page`, `GET /inventory/{variant_id}`, `POST /inventory/adjustments`, `GET /inventory/movements`, `GET /inventory/low-stock` | Adjustments take `counted_quantity` or `quantity_delta`, a `reason` code and a `note`, and write ledger movements |
| POS | `POST /pos/sales`, `GET /pos/sales/{id}` | idempotent on `client_transaction_id`. Never sells below available stock. `SPLIT` takes a `payments` list; only cash can produce change; payment rows store the amount applied |
| Customers | `GET/POST /customers`, `GET /customers/{id}` | Bangladesh phone normalization |
| Orders | `GET/POST /orders`, `POST /orders/{id}/confirm`, `POST /orders/{id}/cancel`, `POST /orders/{id}/transition` | COD risk calculated on create |
| Shipments | `POST /orders/{id}/shipment`, `GET /orders/{id}/shipment`, `POST /orders/{id}/shipment/events` | courier updates drive order status |
| Purchases | `GET/POST /suppliers`, `GET/POST /purchases`, `POST /purchases/{id}/receive` | receiving is idempotent |
| Returns | `GET /returns`, `POST /returns` | References exactly one sale or one shipped order. Every line needs a `SELLABLE`, `DAMAGED` or `MISSING` disposition. Quantities are limited to what was sold and not yet returned. Returning a parcel closes the order as `RETURNED` |
| Sync | `POST /sync/sales`, `GET /sync/conflicts`, `GET /sync/catalog-version`, `GET /sync/catalog`, `GET /sync/stock` | The POS compares the catalog version, downloads the full catalog only when it changed, and refreshes stock separately. See [offline-sync.md](offline-sync.md) |
| Reports | `GET /reports/dashboard`, `GET /reports/summary?start&end`, `GET /reports/sales.csv?start&end` | ranges up to 366 days |
| Activity | `GET /audit`, `GET /notifications`, `POST /notifications/{id}/read`, `POST /notifications/read-all` | |
