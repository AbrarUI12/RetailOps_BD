import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.api.deps import SessionDep, require_permission
from app.models.entities import User
from app.schemas.settings import (
    BranchSettings,
    BranchUpdate,
    OrganizationSettings,
    OrganizationUpdate,
    StaffCreate,
    StaffMemberView,
    StaffUpdate,
    WorkspaceSettings,
)
from app.services.settings_service import SettingsService

router = APIRouter(prefix="/settings", tags=["settings"])
SettingsManager = Annotated[User, Depends(require_permission("settings:manage"))]
StaffManager = Annotated[User, Depends(require_permission("staff:manage"))]


@router.get("", response_model=WorkspaceSettings)
async def get_settings(session: SessionDep, user: SettingsManager) -> WorkspaceSettings:
    return await SettingsService(session, user).get()


@router.patch("/organization", response_model=OrganizationSettings)
async def update_organization(
    command: OrganizationUpdate, session: SessionDep, user: SettingsManager
) -> OrganizationSettings:
    return await SettingsService(session, user).update_organization(command)


@router.patch("/branches/{branch_id}", response_model=BranchSettings)
async def update_branch(
    branch_id: uuid.UUID,
    command: BranchUpdate,
    session: SessionDep,
    user: SettingsManager,
) -> BranchSettings:
    return await SettingsService(session, user).update_branch(branch_id, command)


@router.get("/staff", response_model=list[StaffMemberView])
async def list_staff(session: SessionDep, user: StaffManager) -> list[StaffMemberView]:
    return await SettingsService(session, user).list_staff()


@router.post("/staff", response_model=StaffMemberView, status_code=status.HTTP_201_CREATED)
async def create_staff(
    command: StaffCreate, session: SessionDep, user: StaffManager
) -> StaffMemberView:
    return await SettingsService(session, user).create_staff(command)


@router.patch("/staff/{staff_id}", response_model=StaffMemberView)
async def update_staff(
    staff_id: uuid.UUID,
    command: StaffUpdate,
    session: SessionDep,
    user: StaffManager,
) -> StaffMemberView:
    return await SettingsService(session, user).update_staff(staff_id, command)
