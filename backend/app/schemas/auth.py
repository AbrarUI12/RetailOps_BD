import uuid

from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class UserView(BaseModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    branch_id: uuid.UUID
    email: EmailStr
    full_name: str
    role: str
    permissions: list[str]


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserView
