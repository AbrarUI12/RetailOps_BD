# Architecture

RetailOps BD uses a React PWA client backed by a thin FastAPI HTTP layer, Python services, PostgreSQL, Redis, and Celery. Domain behavior will be added as vertical slices while the server remains authoritative after offline reconciliation.

