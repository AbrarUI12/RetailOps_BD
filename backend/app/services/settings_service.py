import uuid

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.core.security import hash_password, password_problems
from app.models.entities import (
    Branch,
    Organization,
    RefreshSession,
    Role,
    User,
    UserRole,
    utc_now,
)
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
from app.services.audit_service import add_audit


class SettingsService:
    def __init__(self, session: AsyncSession, user: User) -> None:
        self.session = session
        self.user = user

    async def get(self) -> WorkspaceSettings:
        organization = await self._organization()
        branches = list(
            await self.session.scalars(
                select(Branch)
                .where(Branch.organization_id == self.user.organization_id)
                .order_by(Branch.name)
            )
        )
        current = next((branch for branch in branches if branch.id == self.user.branch_id), None)
        if current is None:
            raise AppError(
                "BRANCH_NOT_FOUND", "Your assigned branch was not found", status_code=404
            )
        return WorkspaceSettings(
            organization=OrganizationSettings.model_validate(organization, from_attributes=True),
            current_branch=BranchSettings.model_validate(current, from_attributes=True),
            branches=[
                BranchSettings.model_validate(branch, from_attributes=True) for branch in branches
            ],
        )

    async def update_organization(self, command: OrganizationUpdate) -> OrganizationSettings:
        organization = await self._organization()
        old_data = {"name": organization.name, "timezone": organization.timezone}
        organization.name = command.name
        organization.timezone = command.timezone
        add_audit(
            self.session,
            self.user,
            "settings.organization_updated",
            "organization",
            organization.id,
            old_data=old_data,
            new_data=command.model_dump(),
        )
        await self.session.commit()
        return OrganizationSettings.model_validate(organization, from_attributes=True)

    async def update_branch(self, branch_id: uuid.UUID, command: BranchUpdate) -> BranchSettings:
        branch = await self._branch(branch_id)
        duplicate = await self.session.scalar(
            select(Branch).where(
                Branch.organization_id == self.user.organization_id,
                func.lower(Branch.code) == command.code.lower(),
                Branch.id != branch.id,
            )
        )
        if duplicate:
            raise AppError(
                "DUPLICATE_BRANCH_CODE",
                "Another branch already uses this code",
                status_code=409,
                details={"field": "code"},
            )
        old_data = {"name": branch.name, "code": branch.code, "address": branch.address}
        branch.name = command.name
        branch.code = command.code.upper()
        branch.address = command.address
        add_audit(
            self.session,
            self.user,
            "settings.branch_updated",
            "branch",
            branch.id,
            old_data=old_data,
            new_data={"name": branch.name, "code": branch.code, "address": branch.address},
        )
        await self.session.commit()
        return BranchSettings.model_validate(branch, from_attributes=True)

    async def list_staff(self) -> list[StaffMemberView]:
        rows = await self.session.execute(
            select(User, Role, Branch)
            .join(Role, Role.id == User.role_id)
            .join(Branch, Branch.id == User.branch_id)
            .where(User.organization_id == self.user.organization_id)
            .order_by(User.is_active.desc(), User.full_name)
        )
        return [self._staff_view(user, role, branch) for user, role, branch in rows.all()]

    async def create_staff(self, command: StaffCreate) -> StaffMemberView:
        branch = await self._branch(command.branch_id)
        role = await self._role(command.role)
        problems = password_problems(command.initial_password, email=command.email)
        if problems:
            raise AppError(
                "WEAK_PASSWORD",
                "Choose a stronger initial password",
                status_code=422,
                details={"problems": problems},
            )
        duplicate = await self.session.scalar(
            select(User).where(
                User.organization_id == self.user.organization_id,
                func.lower(User.email) == command.email.lower(),
            )
        )
        if duplicate:
            raise AppError(
                "DUPLICATE_STAFF_EMAIL",
                "A team member already uses this email",
                status_code=409,
                details={"field": "email"},
            )
        staff = User(
            organization_id=self.user.organization_id,
            branch_id=branch.id,
            role_id=role.id,
            email=command.email.lower(),
            full_name=command.full_name,
            password_hash=hash_password(command.initial_password),
        )
        self.session.add(staff)
        await self.session.flush()
        add_audit(
            self.session,
            self.user,
            "staff.created",
            "user",
            staff.id,
            new_data={
                "full_name": staff.full_name,
                "email": staff.email,
                "role": role.name,
                "branch_id": branch.id,
            },
        )
        await self.session.commit()
        return self._staff_view(staff, role, branch)

    async def update_staff(self, staff_id: uuid.UUID, command: StaffUpdate) -> StaffMemberView:
        staff = await self._staff(staff_id)
        if staff.id == self.user.id and (command.role is not None or command.is_active is False):
            raise AppError(
                "SELF_ACCESS_CHANGE",
                "You cannot change your own role or deactivate your own account",
                status_code=409,
            )
        current_role = await self.session.get(Role, staff.role_id)
        if current_role is None:
            raise AppError("ROLE_NOT_FOUND", "The current role was not found", status_code=404)
        role = await self._role(command.role) if command.role is not None else current_role
        branch = (
            await self._branch(command.branch_id)
            if command.branch_id is not None
            else await self._branch(staff.branch_id)
        )
        removes_owner = current_role.name == UserRole.OWNER and (
            role.name != UserRole.OWNER or command.is_active is False
        )
        if removes_owner:
            active_owners = await self.session.scalar(
                select(func.count(User.id))
                .join(Role, Role.id == User.role_id)
                .where(
                    User.organization_id == self.user.organization_id,
                    User.is_active.is_(True),
                    Role.name == UserRole.OWNER,
                )
            )
            if (active_owners or 0) <= 1:
                raise AppError(
                    "LAST_OWNER",
                    "Keep at least one active owner in the workspace",
                    status_code=409,
                )
        old_data = {
            "full_name": staff.full_name,
            "role": current_role.name,
            "branch_id": staff.branch_id,
            "is_active": staff.is_active,
        }
        if command.full_name is not None:
            staff.full_name = command.full_name
        staff.role_id = role.id
        staff.branch_id = branch.id
        if command.is_active is not None:
            staff.is_active = command.is_active
            if not command.is_active:
                await self.session.execute(
                    update(RefreshSession)
                    .where(
                        RefreshSession.user_id == staff.id,
                        RefreshSession.revoked_at.is_(None),
                    )
                    .values(revoked_at=utc_now())
                )
        new_data = {
            "full_name": staff.full_name,
            "role": role.name,
            "branch_id": staff.branch_id,
            "is_active": staff.is_active,
        }
        add_audit(
            self.session,
            self.user,
            "staff.updated",
            "user",
            staff.id,
            old_data=old_data,
            new_data=new_data,
        )
        await self.session.commit()
        return self._staff_view(staff, role, branch)

    async def _organization(self) -> Organization:
        organization = await self.session.scalar(
            select(Organization).where(Organization.id == self.user.organization_id)
        )
        if organization is None:
            raise AppError("ORGANIZATION_NOT_FOUND", "Organization was not found", status_code=404)
        return organization

    async def _branch(self, branch_id: uuid.UUID) -> Branch:
        branch = await self.session.scalar(
            select(Branch).where(
                Branch.id == branch_id,
                Branch.organization_id == self.user.organization_id,
            )
        )
        if branch is None:
            raise AppError("BRANCH_NOT_FOUND", "Branch was not found", status_code=404)
        return branch

    async def _role(self, role_name: UserRole) -> Role:
        role = await self.session.scalar(
            select(Role).where(
                Role.organization_id == self.user.organization_id,
                Role.name == role_name,
            )
        )
        if role is None:
            raise AppError("ROLE_NOT_FOUND", "That role is not configured", status_code=404)
        return role

    async def _staff(self, staff_id: uuid.UUID) -> User:
        staff = await self.session.scalar(
            select(User).where(
                User.id == staff_id,
                User.organization_id == self.user.organization_id,
            )
        )
        if staff is None:
            raise AppError("STAFF_NOT_FOUND", "Team member was not found", status_code=404)
        return staff

    @staticmethod
    def _staff_view(user: User, role: Role, branch: Branch) -> StaffMemberView:
        return StaffMemberView(
            id=user.id,
            full_name=user.full_name,
            email=user.email,
            role=role.name,
            branch_id=branch.id,
            branch_name=branch.name,
            is_active=user.is_active,
            created_at=user.created_at,
        )
