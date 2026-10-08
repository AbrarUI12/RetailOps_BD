from fastapi import status
from httpx import AsyncClient


async def test_configured_origin_receives_cors_headers(client: AsyncClient) -> None:
    response = await client.options(
        "/health/live",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
