import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from app.core.config import get_settings

password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return password_hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def create_access_token(
    *,
    user_id: uuid.UUID,
    organization_id: uuid.UUID,
    session_id: uuid.UUID,
    role: str | None = None,
    permissions: list[str] | None = None,
) -> str:
    """Role and permissions ride along for the client's convenience (plan §33); the server
    re-reads the user on every request and stays authoritative."""
    settings = get_settings()
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "organization_id": str(organization_id),
        "session_id": str(session_id),
        "role": role,
        "permissions": permissions or [],
        "type": "access",
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_minutes),
    }
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def decode_access_token(token: str) -> dict[str, Any]:
    payload = jwt.decode(token, get_settings().secret_key, algorithms=["HS256"])
    if payload.get("type") != "access":
        raise jwt.InvalidTokenError("Token is not an access token")
    return payload


def generate_refresh_token() -> tuple[str, str]:
    token = secrets.token_urlsafe(48)
    return token, hash_refresh_token(token)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


COMMON_PASSWORDS = {"password", "password123", "12345678", "123456789", "qwerty123", "retailops"}
MIN_PASSWORD_LENGTH = 10


def password_problems(password: str, *, email: str | None = None) -> list[str]:
    """Minimum password policy (plan §33). Returns human-readable problems; empty means OK."""
    problems: list[str] = []
    if len(password) < MIN_PASSWORD_LENGTH:
        problems.append(f"Use at least {MIN_PASSWORD_LENGTH} characters")
    if not any(character.isalpha() for character in password) or not any(
        character.isdigit() for character in password
    ):
        problems.append("Mix letters and numbers")
    lowered = password.lower()
    if lowered in COMMON_PASSWORDS or (email and lowered.startswith(email.split("@")[0].lower())):
        problems.append("Avoid common passwords and your email name")
    return problems


def generate_reset_token() -> tuple[str, str]:
    token = secrets.token_urlsafe(32)
    return token, hash_refresh_token(token)
