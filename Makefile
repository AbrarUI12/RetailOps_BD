.PHONY: dev down lint test backend-lint backend-test frontend-lint frontend-test build compose-config

dev:
	docker compose up --build

down:
	docker compose down

backend-lint:
	cd backend && uv run ruff format --check . && uv run ruff check . && uv run mypy app

backend-test:
	cd backend && uv run pytest

frontend-lint:
	cd frontend && npm run lint && npm run typecheck

frontend-test:
	cd frontend && npm run test:run

lint: backend-lint frontend-lint

test: backend-test frontend-test

build:
	cd frontend && npm run build

compose-config:
	docker compose config --quiet

