from sqlalchemy import select

from app.models.entities import AuditLog, Branch, Organization, User
from tests.conftest import DatabaseHarness
from tests.test_api_workflows import login
from tests.test_operations_workflows import owner_headers


async def test_workspace_settings_update_business_and_branch(
    db_client: DatabaseHarness,
) -> None:
    headers = await owner_headers(db_client.client)

    settings = await db_client.client.get("/api/v1/settings", headers=headers)
    assert settings.status_code == 200
    body = settings.json()
    assert body["organization"]["name"] == "Test Retail"
    assert body["organization"]["timezone"] == "Asia/Dhaka"
    assert body["current_branch"]["name"] == "Test Branch"

    organization = await db_client.client.patch(
        "/api/v1/settings/organization",
        headers=headers,
        json={"name": "Dhaka Daily", "timezone": "Asia/Dhaka"},
    )
    branch = await db_client.client.patch(
        f"/api/v1/settings/branches/{body['current_branch']['id']}",
        headers=headers,
        json={"name": "Dhanmondi Flagship", "code": "dhk-01", "address": "Road 27"},
    )

    assert organization.status_code == 200
    assert organization.json()["name"] == "Dhaka Daily"
    assert branch.status_code == 200
    assert branch.json() == {
        "id": body["current_branch"]["id"],
        "name": "Dhanmondi Flagship",
        "code": "DHK-01",
        "address": "Road 27",
    }
    me = await db_client.client.get("/api/v1/auth/me", headers=headers)
    assert me.json()["organization_name"] == "Dhaka Daily"
    assert me.json()["branch_name"] == "Dhanmondi Flagship"
    async with db_client.sessions() as session:
        actions = set(await session.scalars(select(AuditLog.action)))
    assert {"settings.organization_updated", "settings.branch_updated"} <= actions


async def test_settings_permissions_and_tenant_branch_boundary(
    db_client: DatabaseHarness,
) -> None:
    cashier_auth = await login(db_client.client, "cashier@retailopsbd.com")
    cashier = {"Authorization": f"Bearer {cashier_auth['access_token']}"}
    assert (await db_client.client.get("/api/v1/settings", headers=cashier)).status_code == 403

    owner = await owner_headers(db_client.client)
    async with db_client.sessions() as session:
        foreign = Organization(name="Foreign", slug="foreign-settings")
        session.add(foreign)
        await session.flush()
        foreign_branch = Branch(
            organization_id=foreign.id,
            name="Foreign Branch",
            code="FOREIGN",
            address=None,
        )
        session.add(foreign_branch)
        await session.commit()
        foreign_id = foreign_branch.id

    response = await db_client.client.patch(
        f"/api/v1/settings/branches/{foreign_id}",
        headers=owner,
        json={"name": "Taken", "code": "TAKEN", "address": None},
    )
    assert response.status_code == 404


async def test_owner_can_create_and_manage_staff(db_client: DatabaseHarness) -> None:
    owner = await owner_headers(db_client.client)
    settings = (await db_client.client.get("/api/v1/settings", headers=owner)).json()
    branch_id = settings["current_branch"]["id"]

    created = await db_client.client.post(
        "/api/v1/settings/staff",
        headers=owner,
        json={
            "full_name": "New Cashier",
            "email": "new.cashier@example.com",
            "role": "CASHIER",
            "branch_id": branch_id,
            "initial_password": "Welcome2026",
        },
    )
    assert created.status_code == 201
    assert created.json()["role"] == "CASHIER"
    staff_id = created.json()["id"]

    listed = await db_client.client.get("/api/v1/settings/staff", headers=owner)
    assert any(member["email"] == "new.cashier@example.com" for member in listed.json())

    deactivated = await db_client.client.patch(
        f"/api/v1/settings/staff/{staff_id}",
        headers=owner,
        json={"full_name": "New Cashier Updated", "is_active": False},
    )
    assert deactivated.status_code == 200
    assert deactivated.json()["full_name"] == "New Cashier Updated"
    assert deactivated.json()["is_active"] is False
    denied = await db_client.client.post(
        "/api/v1/auth/login",
        json={"email": "new.cashier@example.com", "password": "Welcome2026"},
    )
    assert denied.status_code == 401
    assert denied.json()["error"]["code"] == "INVALID_CREDENTIALS"

    duplicate = await db_client.client.post(
        "/api/v1/settings/staff",
        headers=owner,
        json={
            "full_name": "Duplicate",
            "email": "new.cashier@example.com",
            "role": "CASHIER",
            "branch_id": branch_id,
            "initial_password": "Welcome2026",
        },
    )
    assert duplicate.status_code == 409


async def test_owner_cannot_remove_own_access(db_client: DatabaseHarness) -> None:
    headers = await owner_headers(db_client.client)
    async with db_client.sessions() as session:
        owner = await session.scalar(select(User).where(User.email == "owner@retailopsbd.com"))
        assert owner is not None
        owner_id = owner.id

    response = await db_client.client.patch(
        f"/api/v1/settings/staff/{owner_id}",
        headers=headers,
        json={"is_active": False},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "SELF_ACCESS_CHANGE"
