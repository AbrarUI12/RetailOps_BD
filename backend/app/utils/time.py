from datetime import UTC, date, datetime, time, timedelta, timezone

# Bangladesh has used a fixed UTC+6 offset with no DST since 2009, so a fixed zone avoids a
# runtime dependency on the tz database (absent on Windows without the tzdata package).
BUSINESS_TZ = timezone(timedelta(hours=6), "Asia/Dhaka")


def business_today() -> date:
    return datetime.now(BUSINESS_TZ).date()


def business_day_start(day: date) -> datetime:
    """UTC instant at which the given Dhaka calendar day begins."""
    return datetime.combine(day, time.min, tzinfo=BUSINESS_TZ).astimezone(UTC)


def as_utc(moment: datetime) -> datetime:
    """SQLite returns naive datetimes; every stored timestamp is UTC."""
    return moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment.astimezone(UTC)
