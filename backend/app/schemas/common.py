from pydantic import BaseModel, Field


class PageMeta(BaseModel):
    page: int
    page_size: int
    total: int


class PaginationParams(BaseModel):
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=25, ge=1, le=100)
