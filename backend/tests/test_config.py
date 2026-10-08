import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_settings_accept_valid_cors_origins() -> None:
    settings = Settings(cors_origins=["https://retailops.example.com"])

    assert settings.cors_origins == ["https://retailops.example.com"]


def test_settings_reject_invalid_cors_origins() -> None:
    with pytest.raises(ValidationError):
        Settings(cors_origins=["retailops.example.com"])


def test_frontend_host_becomes_the_https_origin() -> None:
    settings = Settings(frontend_host="retailops-bd.onrender.com")

    assert settings.cors_origins == ["https://retailops-bd.onrender.com"]


def test_production_rejects_unsafe_defaults() -> None:
    with pytest.raises(ValidationError) as error:
        Settings.model_validate({"APP_ENV": "production", "debug": True, "secret_key": "short"})

    message = str(error.value)
    assert "APP_SECRET_KEY" in message
    assert "APP_DEBUG" in message
    assert "APP_SECURE_COOKIES" in message
    assert "HTTPS" in message


def test_production_accepts_hardened_settings() -> None:
    settings = Settings.model_validate(
        {
            "APP_ENV": "production",
            "secret_key": "x" * 48,
            "secure_cookies": True,
            "frontend_host": "retailops-bd.onrender.com",
        }
    )

    assert settings.cors_origins == ["https://retailops-bd.onrender.com"]
