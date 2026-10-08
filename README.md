# RetailOps BD

**Sell anywhere. Track everything. Keep working offline.**

RetailOps BD is a production-oriented retail operations platform for Bangladesh-focused SMEs. This repository currently contains the full-stack foundation and interface system for the future offline-first POS, inventory, order, courier, returns, and analytics workflows.

## Stack

- Python 3.13.16, FastAPI, SQLAlchemy, PostgreSQL 17
- Redis 7.4 and Celery
- React 19, TypeScript, Vite, Tailwind CSS, Motion
- Docker Compose, Pytest, Vitest, Ruff, mypy, ESLint

## Start with Docker

```bash
docker compose up --build
```

Then open:

- Application: <http://localhost:5173>
- API documentation: <http://localhost:8000/docs>
- Liveness: <http://localhost:8000/health/live>
- Readiness: <http://localhost:8000/health/ready>

## Native development

Backend:

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

PostgreSQL and Redis must be available at the URLs configured through the `APP_` environment variables. Copy `.env.example` to `.env` only when you need to override Compose defaults.

## Quality checks

```bash
make lint
make test
make build
make compose-config
```

See [plan.md](plan.md) for the complete product and delivery roadmap.

