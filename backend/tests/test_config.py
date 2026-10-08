import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_settings_accept_valid_cors_origins() -> None:
    settings = Settings(cors_origins=["https://retailops.example.com"])

    assert settings.cors_origins == ["https://retailops.example.com"]


def test_settings_reject_invalid_cors_origins() -> None:
    with pytest.raises(ValidationError):
        Settings(cors_origins=["retailops.example.com"])
