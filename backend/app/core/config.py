from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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
    database_url: str = "postgresql+psycopg://retailops:retailops@localhost:5432/retailops"
    redis_url: str = "redis://localhost:6379/0"
    cors_origins: list[str] = ["http://localhost:5173"]

    @field_validator("cors_origins")
    @classmethod
    def origins_must_be_http(cls, origins: list[str]) -> list[str]:
        if not origins or any(not origin.startswith(("http://", "https://")) for origin in origins):
            raise ValueError("CORS origins must contain valid HTTP(S) origins")
        return origins


@lru_cache
def get_settings() -> Settings:
    return Settings()
