import re

from app.core.exceptions import AppError

BD_MOBILE_PATTERN = re.compile(r"^\+8801[3-9]\d{8}$")


def normalize_bd_phone(value: str) -> str:
    digits = re.sub(r"\D", "", value)
    if digits.startswith("880"):
        normalized = f"+{digits}"
    elif digits.startswith("01"):
        normalized = f"+88{digits}"
    else:
        raise AppError("INVALID_PHONE", "Enter a valid Bangladesh mobile number")
    if not BD_MOBILE_PATTERN.fullmatch(normalized):
        raise AppError("INVALID_PHONE", "Enter a valid Bangladesh mobile number")
    return normalized
