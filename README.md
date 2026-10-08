# RetailOps BD

**Offline-first POS & commerce operations platform**

[![CI](https://github.com/AbrarUI12/RetailOps_BD/actions/workflows/ci.yml/badge.svg)](https://github.com/AbrarUI12/RetailOps_BD/actions/workflows/ci.yml)

RetailOps BD is a production-oriented retail operations platform for SMEs in Bangladesh. It covers:

- POS sales, products and variants
- an auditable inventory ledger
- customers
- Facebook and manual COD orders
- courier shipments and returns
- analytics

It keeps selling during internet outages and syncs every offline sale **exactly once** when the connection returns.

`Python` · `FastAPI` · `PostgreSQL` · `SQLAlchemy` · `Redis` · `Celery` · `React` · `TypeScript` · `IndexedDB` · `Motion` · `PWA` · `Docker`

## Highlights

- **Offline-first POS.** Sales persist to IndexedDB, survive reloads, and print receipts without a network.
- **Idempotent synchronization.** A client-generated `client_transaction_id` makes a retried sale return the original. There is never a second sale, payment or stock deduction.
- **Inventory reconciliation.** An offline oversell is never silently deleted. The sale is kept and an inventory conflict is raised for manager review.
- **Auditable stock ledger.** Every stock change is an immutable movement: sale, adjustment, purchase, reservation fulfilment, or one of three return dispositions.
- **Bangladesh COD workflows.** Phone normalization, explainable rule-based COD risk scoring, and order reservations with a strict state machine.
- **Courier adapter architecture.** A provider protocol, normalized courier statuses and shipment timelines, with a mock provider first.
- **Role-based access.** Owner, manager, cashier, support and warehouse roles, enforced on the server.
- **Reports.** Sales, product, inventory valuation, COD and courier outcomes by Dhaka business day, with CSV export.
- **Automated tests and CI/CD.** Pytest on SQLite and PostgreSQL, Vitest, migration drift checks, and a deploy gated on green checks.

## Architecture

```mermaid
flowchart LR
  subgraph Browser["Browser / installed PWA"]
    UI["React + Motion UI"] --> Q[("IndexedDB<br/>catalog + sale queue")]
    UI --> SE["Sync engine<br/>probe · ordered queue · backoff"]
    SE --> Q
  end
  SE -->|"POST /sync/sales (idempotent)"| API
  UI -->|"/api/v1"| API["FastAPI<br/>thin routes"]
  API --> SVC["Python services<br/>sales · inventory · orders · sync · reports"]
  SVC --> PG[("PostgreSQL<br/>authoritative")]
  SVC --> R[("Redis")]
  W["Housekeeping jobs<br/>Celery beat locally · in-API scheduler on Render<br/>low-stock alerts · stale sync release"] --> R
  W --> PG
```

More detail:

- [docs/architecture.md](docs/architecture.md): layers and rules
- [docs/offline-sync.md](docs/offline-sync.md): the offline write path, idempotency contract and conflict strategy, with a sequence diagram
- [docs/api.md](docs/api.md): the API surface
- [docs/deployment.md](docs/deployment.md): Render topology and runbook

## Run locally

```bash
docker compose up --build
docker compose exec backend uv run python -m scripts.seed_demo   # demo tenant, idempotent
```

The frontend container keeps `node_modules` in a named volume. After pulling changes that add packages, install them inside the container:

```bash
docker compose exec frontend npm ci
```

| | URL |
| --- | --- |
| App | <http://localhost:5173> |
| API docs (OpenAPI) | <http://localhost:8000/docs> |
| Readiness | <http://localhost:8000/health/ready> |

All demo users share the password `RetailOps123!`:

- `owner@retailopsbd.com`
- `manager@retailopsbd.com`
- `cashier@retailopsbd.com`
- `support@retailopsbd.com`
- `warehouse@retailopsbd.com`

### Try the offline flow

1. Sign in as the cashier and open **POS** once while online. This caches the catalog.
2. In DevTools → Network, switch to **Offline**.
3. Sell something. The receipt prints and the header shows the pending count.
4. Reload the page. The sale is still queued.
5. Go back online. The **Sync Center** shows it syncing once, and the server sale appears in Reports.

## Native development

```bash
cd backend && uv sync && uv run uvicorn app.main:app --reload
cd frontend && npm install && npm run dev
```

PostgreSQL and Redis must be reachable at the `APP_DATABASE_URL` / `APP_REDIS_URL` values in [.env.example](.env.example).

## Quality checks

```bash
make lint      # ruff, mypy, eslint, tsc
make test      # pytest (SQLite) + vitest
make build
```

To run the backend suite against PostgreSQL as CI does, point `APP_TEST_DATABASE_URL` at an empty database:

```bash
APP_TEST_DATABASE_URL=postgresql+psycopg://retailops:retailops@localhost:5432/retailops_test uv run pytest
```

[plan.md](plan.md) is the product and roadmap source of truth. [AGENTS.md](AGENTS.md) records what has been built.
