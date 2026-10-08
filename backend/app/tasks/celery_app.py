from celery import Celery

from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "retailops",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.tasks.jobs"],
)
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="Asia/Dhaka",
    enable_utc=True,
    task_track_started=True,
    result_expires=3600,
    broker_connection_retry_on_startup=True,
    beat_schedule={
        "low-stock-alerts": {"task": "inventory.low_stock_alerts", "schedule": 15 * 60},
        "release-stale-sync": {"task": "sync.release_stale_transactions", "schedule": 5 * 60},
    },
)
