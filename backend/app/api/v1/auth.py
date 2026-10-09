from typing import Annotated

from fastapi import APIRouter, Cookie, Request, Response, status

from app.api.deps import CurrentUser, SessionDep
from app.core.config import get_settings
from app.core.exceptions import AppError
from app.schemas.auth import (
    AuthResponse,
    ChangePasswordRequest,
    ForgotPasswordRequest,
    LoginRequest,
    ResetPasswordRequest,
    UserView,
)
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


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT)
async def logout_all(response: Response, session: SessionDep, user: CurrentUser) -> None:
    """Sign out of every device, e.g. after a lost phone."""
    await AuthService(session).logout_everywhere(user)
    response.delete_cookie(REFRESH_COOKIE, path="/api/v1/auth")


@router.get("/me", response_model=UserView)
async def me(user: CurrentUser, session: SessionDep) -> UserView:
    return await user_view(session, user)


@router.post("/forgot-password", status_code=status.HTTP_202_ACCEPTED)
async def forgot_password(command: ForgotPasswordRequest, session: SessionDep) -> dict[str, str]:
    await AuthService(session).forgot_password(command.email)
    return {"message": "If that email has an account, a reset link is on its way."}


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(command: ResetPasswordRequest, session: SessionDep) -> None:
    await AuthService(session).reset_password(command.token, command.new_password)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    command: ChangePasswordRequest, request: Request, session: SessionDep, user: CurrentUser
) -> None:
    """Changing the password signs out every other device but keeps this one."""
    await AuthService(session).change_password(
        user, command.current_password, command.new_password, request.state.session_id
    )
