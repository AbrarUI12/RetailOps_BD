from functools import lru_cache
from typing import Literal

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
    # Run housekeeping jobs inside the API when there is no separate Celery worker.
    run_scheduler: bool = False
    database_pool_size: int = 5
    database_max_overflow: int = 5

    @field_validator("cors_origins")
    @classmethod
    def origins_must_be_http(cls, origins: list[str]) -> list[str]:
        if not origins or any(not origin.startswith(("http://", "https://")) for origin in origins):
            raise ValueError("CORS origins must contain valid HTTP(S) origins")
        return origins

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


@lru_cache
def get_settings() -> Settings:
    return Settings()
