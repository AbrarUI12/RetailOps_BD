FROM ghcr.io/astral-sh/uv:0.12.23 AS uv

FROM python:3.13.16-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy
WORKDIR /app
COPY --from=uv /uv /uvx /bin/
COPY pyproject.toml uv.lock* README.md ./
RUN useradd --create-home --uid 10001 appuser && chown appuser:appuser /app
USER appuser

FROM base AS development
RUN uv sync --no-install-project
COPY . .
RUN uv sync
EXPOSE 8000
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

FROM base AS production
RUN uv sync --frozen --no-dev --no-install-project
COPY . .
RUN uv sync --frozen --no-dev
# Run the synced virtualenv directly: `uv run` would re-sync and pull dev dependencies at boot.
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
CMD ["sh", "scripts/start_api.sh"]

