from functools import lru_cache
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEVELOPMENT_ORIGINS = ["http://localhost:5173"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="APP_",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "RetailOps BD API"
    app_version: str = "0.1.0"
    environment: Literal["development", "test", "production"] = Field(
        default="development", validation_alias="APP_ENV"
    )
    debug: bool = False
    secret_key: str = "development-only-secret"
    access_token_minutes: int = 15
    refresh_token_days: int = 14
    secure_cookies: bool = False
    database_url: str = "postgresql+psycopg://retailops:retailops@localhost:5432/retailops"
    redis_url: str = "redis://localhost:6379/0"
    cors_origins: list[str] = Field(default_factory=lambda: list(DEVELOPMENT_ORIGINS))
    allowed_hosts: list[str] = ["localhost", "127.0.0.1", "test", "testserver"]
    # Bare hostname of the deployed web app (Render's fromService `host`); served over HTTPS.
    frontend_host: str | None = None
    password_reset_minutes: int = 30
    # Run housekeeping jobs inside the API when there is no separate Celery worker.
    run_scheduler: bool = False
    database_pool_size: int = 5
    database_max_overflow: int = 5

    @field_validator("cors_origins")
    @classmethod
    def origins_must_be_http(cls, origins: list[str]) -> list[str]:
        normalized: list[str] = []
        for origin in origins:
            try:
                parsed = urlsplit(origin)
                valid_port = parsed.port is not None or ":" not in parsed.netloc
            except ValueError:
                valid_port = False
                parsed = urlsplit("")
            if (
                parsed.scheme not in {"http", "https"}
                or not parsed.hostname
                or parsed.username is not None
                or parsed.password is not None
                or parsed.query
                or parsed.fragment
                or parsed.path not in {"", "/"}
                or not valid_port
            ):
                raise ValueError("CORS origins must contain valid HTTP(S) origins")
            normalized.append(f"{parsed.scheme}://{parsed.netloc}".rstrip("/"))
        if not normalized:
            raise ValueError("CORS origins must contain valid HTTP(S) origins")
        return list(dict.fromkeys(normalized))

    @field_validator("frontend_host")
    @classmethod
    def frontend_host_must_be_bare_hostname(cls, value: str | None) -> str | None:
        if value is None:
            return None
        candidate = value.strip().removeprefix("https://")
        try:
            parsed = urlsplit(f"https://{candidate}")
            valid_port = parsed.port is not None or ":" not in parsed.netloc
        except ValueError:
            valid_port = False
            parsed = urlsplit("")
        if (
            not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path not in {"", "/"}
            or parsed.query
            or parsed.fragment
            or not valid_port
        ):
            raise ValueError("APP_FRONTEND_HOST must be a bare hostname with an optional port")
        return parsed.netloc

    @model_validator(mode="after")
    def include_frontend_origin(self) -> "Settings":
        if self.frontend_host:
            origin = f"https://{self.frontend_host.strip().removeprefix('https://')}"
            if self.cors_origins == DEVELOPMENT_ORIGINS:
                self.cors_origins = [origin]
            elif origin not in self.cors_origins:
                self.cors_origins = [*self.cors_origins, origin]
        return self

    @model_validator(mode="after")
    def production_must_be_hardened(self) -> "Settings":
        if self.environment != "production":
            return self
        problems = []
        if self.secret_key == "development-only-secret" or len(self.secret_key) < 32:
            problems.append("APP_SECRET_KEY must be a unique value of at least 32 characters")
        if self.debug:
            problems.append("APP_DEBUG must be false")
        if not self.secure_cookies:
            problems.append("APP_SECURE_COOKIES must be true")
        if any(origin.startswith("http://") for origin in self.cors_origins):
            problems.append("APP_CORS_ORIGINS must use HTTPS")
        if "*" in self.allowed_hosts:
            problems.append("APP_ALLOWED_HOSTS must not allow every host")
        if problems:
            raise ValueError("; ".join(problems))
        return self

    @field_validator("database_url")
    @classmethod
    def normalize_database_driver(cls, value: str) -> str:
        if value.startswith("postgres://"):
            return value.replace("postgres://", "postgresql+psycopg://", 1)
        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+psycopg://", 1)
        return value


def public_app_url(settings: "Settings") -> str:
    """Where emailed links (password reset) point."""
    if settings.frontend_host:
        return f"https://{settings.frontend_host.strip().removeprefix('https://')}"
    return settings.cors_origins[0]


@lru_cache
def get_settings() -> Settings:
    return Settings()
