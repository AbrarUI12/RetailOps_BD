from fastapi import APIRouter

from app.api.v1.activity import router as activity_router
from app.api.v1.auth import router as auth_router
from app.api.v1.customers import router as customers_router
from app.api.v1.health import router as health_router
from app.api.v1.inventory import router as inventory_router
from app.api.v1.orders import router as orders_router
from app.api.v1.procurement import router as procurement_router
from app.api.v1.products import router as products_router
from app.api.v1.reports import router as reports_router
from app.api.v1.sales import router as sales_router
from app.api.v1.sync import router as sync_router
from app.api.v1.workspace import router as workspace_router

api_router = APIRouter()
api_router.include_router(health_router)

v1_router = APIRouter(prefix="/api/v1")
v1_router.include_router(auth_router)
v1_router.include_router(products_router)
v1_router.include_router(inventory_router)
v1_router.include_router(sales_router)
v1_router.include_router(reports_router)
v1_router.include_router(customers_router)
v1_router.include_router(orders_router)
v1_router.include_router(sync_router)
v1_router.include_router(procurement_router)
v1_router.include_router(activity_router)
v1_router.include_router(workspace_router)
api_router.include_router(v1_router)
