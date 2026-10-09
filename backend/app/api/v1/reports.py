import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response

from app.api.deps import SessionDep, require_permission
from app.models.entities import User
from app.schemas.reports import DashboardReport, SummaryReport
from app.services.report_service import ReportService
from app.utils.time import business_today

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/dashboard", response_model=DashboardReport)
async def dashboard(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("report:read"))],
    start: Annotated[date | None, Query(description="First Dhaka calendar day")] = None,
    end: Annotated[date | None, Query(description="Last Dhaka calendar day, inclusive")] = None,
    branch_id: uuid.UUID | None = None,
) -> DashboardReport:
    today = business_today()
    last = end or today
    first = start or last
    return await ReportService(session, user).dashboard(first, last, branch_id)


@router.get("/summary", response_model=SummaryReport)
async def summary(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("report:read"))],
    start: Annotated[date | None, Query(description="First Dhaka calendar day")] = None,
    end: Annotated[date | None, Query(description="Last Dhaka calendar day, inclusive")] = None,
) -> SummaryReport:
    today = business_today()
    return await ReportService(session, user).summary(start or today, end or today)


@router.get("/sales.csv", response_class=Response)
async def sales_csv(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("report:read"))],
    start: Annotated[date | None, Query()] = None,
    end: Annotated[date | None, Query()] = None,
) -> Response:
    today = business_today()
    first, last = start or today, end or today
    body = await ReportService(session, user).sales_csv(first, last)
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="sales-{first}-to-{last}.csv"'},
    )


@router.get("/products.csv", response_class=Response)
async def products_csv(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission("report:read"))],
    start: Annotated[date | None, Query()] = None,
    end: Annotated[date | None, Query()] = None,
) -> Response:
    today = business_today()
    first, last = start or today, end or today
    body = await ReportService(session, user).products_csv(first, last)
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="products-{first}-to-{last}.csv"'},
    )
