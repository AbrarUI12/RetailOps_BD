import re
import uuid
from typing import Annotated

from pydantic import AfterValidator, BaseModel, EmailStr, Field, TypeAdapter

_EMAIL = TypeAdapter(EmailStr)
_DEMO_EMAIL = re.compile(r"^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@demo\.local$")


def validate_account_email(value: str) -> str:
    """Keep production email validation strict while supporting plan-defined demo identities."""
    normalized = value.strip().lower()
    if _DEMO_EMAIL.fullmatch(normalized):
        return normalized
    return str(_EMAIL.validate_python(normalized))


AccountEmail = Annotated[str, AfterValidator(validate_account_email)]


class LoginRequest(BaseModel):
    email: AccountEmail
    password: str = Field(min_length=8, max_length=128)


class UserView(BaseModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    organization_name: str
    branch_id: uuid.UUID
    branch_name: str
    branch_address: str | None = None
    email: AccountEmail
    full_name: str
    role: str
    permissions: list[str]


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserView


class ForgotPasswordRequest(BaseModel):
    email: AccountEmail


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=20, max_length=200)
    new_password: str = Field(min_length=1, max_length=128)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=1, max_length=128)
