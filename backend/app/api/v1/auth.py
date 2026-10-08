from typing import Annotated

from fastapi import APIRouter, Cookie, Request, Response, status

from app.api.deps import CurrentUser, SessionDep
from app.core.config import get_settings
from app.core.exceptions import AppError
from app.schemas.auth import AuthResponse, LoginRequest, UserView
from app.services.auth_service import AuthService, user_view

router = APIRouter(prefix="/auth", tags=["authentication"])
REFRESH_COOKIE = "retailops_refresh"


def set_refresh_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        REFRESH_COOKIE,
        token,
        max_age=settings.refresh_token_days * 24 * 60 * 60,
        httponly=True,
        secure=settings.secure_cookies,
        samesite="lax",
        path="/api/v1/auth",
    )


@router.post("/login", response_model=AuthResponse)
async def login(
    command: LoginRequest, request: Request, response: Response, session: SessionDep
) -> AuthResponse:
    result, refresh_token = await AuthService(session).login(
        command.email,
        command.password,
        request.headers.get("user-agent"),
    )
    set_refresh_cookie(response, refresh_token)
    return result


@router.post("/refresh", response_model=AuthResponse)
async def refresh(
    request: Request,
    response: Response,
    session: SessionDep,
    refresh_token: Annotated[str | None, Cookie(alias=REFRESH_COOKIE)] = None,
) -> AuthResponse:
    if not refresh_token:
        raise AppError("MISSING_REFRESH", "Refresh session is required", status_code=401)
    result, rotated_token = await AuthService(session).refresh(
        refresh_token,
        request.headers.get("user-agent"),
    )
    set_refresh_cookie(response, rotated_token)
    return result


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    session: SessionDep,
    refresh_token: Annotated[str | None, Cookie(alias=REFRESH_COOKIE)] = None,
) -> None:
    await AuthService(session).logout(refresh_token)
    response.delete_cookie(REFRESH_COOKIE, path="/api/v1/auth")


@router.get("/me", response_model=UserView)
async def me(user: CurrentUser) -> UserView:
    return user_view(user)
