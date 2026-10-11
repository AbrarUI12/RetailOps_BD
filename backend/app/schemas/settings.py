import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.entities import UserRole
from app.schemas.auth import AccountEmail


class OrganizationSettings(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    timezone: str


class BranchSettings(BaseModel):
    id: uuid.UUID
    name: str
    code: str
    address: str | None


class WorkspaceSettings(BaseModel):
    organization: OrganizationSettings
    current_branch: BranchSettings
    branches: list[BranchSettings]


class OrganizationUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    timezone: str = Field(default="Asia/Dhaka", max_length=64)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        return value.strip()

    @field_validator("timezone")
    @classmethod
    def supported_timezone(cls, value: str) -> str:
        if value != "Asia/Dhaka":
            raise ValueError("RetailOps BD currently displays business time in Asia/Dhaka")
        return value


class BranchUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    code: str = Field(min_length=2, max_length=24, pattern=r"^[A-Za-z0-9_-]+$")
    address: str | None = Field(default=None, max_length=500)

    @field_validator("name", "code")
    @classmethod
    def clean_required(cls, value: str) -> str:
        return value.strip()

    @field_validator("address")
    @classmethod
    def clean_optional(cls, value: str | None) -> str | None:
        cleaned = value.strip() if value else ""
        return cleaned or None


class StaffMemberView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    full_name: str
    email: AccountEmail
    role: UserRole
    branch_id: uuid.UUID
    branch_name: str
    is_active: bool
    created_at: datetime


class StaffCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: AccountEmail
    role: UserRole
    branch_id: uuid.UUID
    initial_password: str = Field(min_length=1, max_length=128)

    @field_validator("full_name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        return value.strip()


class StaffUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    role: UserRole | None = None
    branch_id: uuid.UUID | None = None
    is_active: bool | None = None

    @field_validator("full_name")
    @classmethod
    def clean_name(cls, value: str | None) -> str | None:
        return value.strip() if value else value

    @model_validator(mode="after")
    def require_change(self) -> "StaffUpdate":
        if not self.model_fields_set:
            raise ValueError("Provide at least one staff change")
        return self
