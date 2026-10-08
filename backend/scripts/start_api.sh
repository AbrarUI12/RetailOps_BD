#!/bin/sh
# Production entrypoint: migrate, optionally seed the public demo tenant, then serve.
set -eu

alembic upgrade head

if [ "${APP_SEED_DEMO:-false}" = "true" ]; then
  python -m scripts.seed_demo
fi

# --proxy-headers makes client IPs (login rate limiting, logs) come from X-Forwarded-For.
exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-8000}" \
  --proxy-headers \
  --forwarded-allow-ips '*' \
  --workers "${WEB_CONCURRENCY:-1}"
