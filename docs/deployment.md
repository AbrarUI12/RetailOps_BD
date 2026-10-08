# Deployment

RetailOps BD deploys to [Render](https://render.com) from the [render.yaml](../render.yaml) Blueprint at the repository root.

## Topology

```mermaid
flowchart LR
  browser["Browser / installed PWA"] -->|HTTPS| web["retailops-bd<br/>static site"]
  web -->|"rewrite /api/*, /health/*"| api["retailops-bd-api<br/>FastAPI (Docker)"]
  api --> pg[("retailops-bd-postgres<br/>PostgreSQL 17")]
  api --> kv[("retailops-bd-cache<br/>Key Value")]
```

| Service | Type | Plan | Notes |
| --- | --- | --- | --- |
| `retailops-bd` | Static site | Free | Vite build, SPA rewrite, security and cache headers |
| `retailops-bd-api` | Web service (Docker) | Free | Migrates on boot, health check `/health/ready`, runs the housekeeping scheduler |
| `retailops-bd-cache` | Key Value | Free | `noeviction`; used for readiness and, with a future worker, as the Celery broker |
| `retailops-bd-postgres` | PostgreSQL 17 | Free | Free databases expire after 30 days; upgrade for anything long-lived |

Postgres and Key Value accept private-network connections only (`ipAllowList: []`).

### Background jobs without a worker

Render has no free background-worker tier. With `APP_RUN_SCHEDULER=true`, the API runs the housekeeping jobs in-process ([app/core/scheduler.py](../backend/app/core/scheduler.py)):

- release `SYNCING` transactions that have gone stale, every 5 minutes;
- generate low-stock alerts, every 15 minutes.

Both jobs are idempotent. A free web service sleeps after about 15 idle minutes and the jobs pause with it, then catch up on the next request.

Locally, Docker Compose still runs the Celery worker with beat. To move to a dedicated worker later:

1. Add a `worker` service on a paid plan running `celery -A app.tasks.celery_app:celery_app worker --beat`.
2. Set `APP_RUN_SCHEDULER=false` on the API.

### Why the API is proxied through the static site

`onrender.com` is on the Public Suffix List, so browsers treat `retailops-bd.onrender.com` and `retailops-bd-api.onrender.com` as **different sites**. Because of that, a `SameSite=Lax` refresh cookie set by the API would never be sent on the frontend's `fetch` calls, and users would be signed out whenever the 15-minute access token expired.

The static site rewrites `/api/*` and `/health/*` to the API instead. The browser only ever talks to one origin, which gives three benefits:

- The refresh cookie stays first-party.
- CORS is not on the critical path.
- The PWA's connectivity probe (`/health/live`) checks the real API.

Production builds therefore default `VITE_API_URL` to an empty string, meaning same-origin.

## Production configuration

The API refuses to start with `APP_ENV=production` unless all of the following hold:

- `APP_SECRET_KEY` is unique and at least 32 characters. Render generates it.
- `APP_DEBUG=false`.
- `APP_SECURE_COOKIES=true`.
- Every CORS origin is HTTPS. `APP_FRONTEND_HOST` becomes the `https://` origin.

Other production behavior:

- **Trusted hosts:** `*.onrender.com`. `/health/*` is exempt so platform probes always reach the API.
- **Client IPs:** uvicorn runs with `--proxy-headers`, so login rate limiting keys on the real client IP rather than Render's proxy.
- **Database pools:** 5 + 5 overflow on the API, which stays well inside the free Postgres connection limit.
- **Demo data:** `APP_SEED_DEMO=true` seeds the demo tenant on boot. The seed is idempotent and does nothing once the tenant exists. Set it only in the public demo environment.

## First deploy

1. Push `main` and make sure the GitHub Actions CI run is green. Every service uses `autoDeployTrigger: checksPass`.
2. In the Render dashboard, choose **New → Blueprint**, select this repository, and apply `render.yaml`.
3. Render shows the planned resources. Every service is on a free plan, so no payment method is needed.
4. After the first deploy, confirm the assigned hostnames are `retailops-bd.onrender.com` and `retailops-bd-api.onrender.com`. If Render added a suffix because a name was taken, update these and redeploy:
   - the two rewrite destinations,
   - `APP_FRONTEND_HOST` on the API.
5. Run the smoke test from any machine with Python 3:

   ```bash
   python backend/scripts/smoke_test.py https://retailops-bd.onrender.com --demo
   ```

   It checks:
   - HTTPS and security headers,
   - the SPA rewrite,
   - readiness of the database and Redis through the proxy,
   - credential rejection,
   - demo sign-in with a first-party refresh cookie,
   - refresh rotation,
   - the dashboard report,
   - the seeded catalog.

The free web service sleeps when idle. The first request after a pause can take about a minute, and the smoke test allows for that.

## Every deploy

- `scripts/start_api.sh` runs `alembic upgrade head` before uvicorn starts. A failed migration fails the deploy, and the previous version keeps serving.
- CI has already proven the migration on a fresh PostgreSQL 17 database (upgrade, drift check, downgrade, upgrade) before Render deploys anything.
- Follow [migration rules](../plan.md#73-migration-rules). Never ship a migration that has not been read and tested on a fresh database.

## Rollback

Use **Manual Deploy → Rollback** on the service in the dashboard. If the bad deploy included a migration, roll the schema back first with `alembic downgrade <revision>` from a Render shell, then roll back the service.

## Local production image

```bash
docker build --target production -t retailops-bd-api ./backend
docker run --rm -p 8000:8000 \
  -e APP_ENV=production -e APP_SECRET_KEY=$(openssl rand -hex 32) -e APP_SECURE_COOKIES=true \
  -e APP_FRONTEND_HOST=localhost:5173 \
  -e APP_DATABASE_URL=postgresql://retailops:retailops@host.docker.internal:5432/retailops \
  -e APP_REDIS_URL=redis://host.docker.internal:6379/0 \
  retailops-bd-api
```
