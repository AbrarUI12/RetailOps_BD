from typing import Literal

from pydantic import BaseModel


class LiveHealth(BaseModel):
    status: Literal["ok"] = "ok"
    service: str
    version: str


class DependencyChecks(BaseModel):
    database: Literal["ok", "unavailable"]
    redis: Literal["ok", "unavailable"]


class ReadyHealth(BaseModel):
    status: Literal["ready", "not_ready"]
    checks: DependencyChecks
