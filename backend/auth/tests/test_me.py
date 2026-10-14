"""GET /me, request authentication, and deny-by-default role checks."""

import uuid

import pytest

from common import auth, db, rbac
from common.errors import Forbidden, Unauthorized

pytestmark = pytest.mark.integration


def test_me_returns_exactly_the_public_fields(api, make_employee, login):
    emp = make_employee(role="manager", job_title="Delivery Lead")
    resp = api("GET", "/api/auth/me", token=login(emp)["access_token"])
    assert resp.status == 200
    assert resp.json == {"id": str(emp["id"]), "email": emp["email"], "name": emp["name"],
                         "role": "manager", "job_title": "Delivery Lead"}
    for word in ("password_hash", "salary", "failed_attempts", "locked_until"):
        assert word not in resp.text


@pytest.mark.parametrize("headers", [
    pytest.param({}, id="no-header"),
    pytest.param({"authorization": "Bearer"}, id="bearer-without-token"),
    pytest.param({"authorization": "Bearer "}, id="bearer-blank"),
    pytest.param({"authorization": "Token abc"}, id="wrong-scheme"),
])
def test_me_without_a_token_is_401(api, headers):
    resp = api("GET", "/api/auth/me", headers=headers)
    assert resp.status == 401
    assert resp.json["error"]["code"] == "unauthorized"


def test_me_with_a_garbage_token_is_401_invalid_token(api):
    resp = api("GET", "/api/auth/me", token="not-a-jwt")
    assert resp.status == 401 and resp.json["error"]["code"] == "invalid_token"


def test_me_with_a_refresh_token_instead_of_access_token_is_401(api, make_employee, login):
    emp = make_employee()
    resp = api("GET", "/api/auth/me", token=login(emp)["refresh_token"])
    assert resp.status == 401


def test_me_with_an_expired_token_is_401_token_expired(api, make_employee):
    emp = make_employee()
    import datetime
    import jwt
    now = int(datetime.datetime.now(datetime.timezone.utc).timestamp())
    token = jwt.encode({"sub": str(emp["id"]), "role": "employee", "type": "access",
                        "iat": now - 1000, "exp": now - 10}, auth._signing_key(), algorithm="HS256")
    resp = api("GET", "/api/auth/me", token=token)
    assert resp.status == 401 and resp.json["error"]["code"] == "token_expired"


def test_role_comes_from_the_database_not_the_token(api, make_employee, login):
    emp = make_employee(role="employee")
    token = login(emp)["access_token"]
    assert auth.decode_access_token(token)["role"] == "employee"

    db.execute("UPDATE employees SET role = 'admin' WHERE id = %s", (str(emp["id"]),))
    assert api("GET", "/api/auth/me", token=token).json["role"] == "admin"


def test_token_claiming_admin_does_not_make_an_employee_admin(api, make_employee):
    emp = make_employee(role="employee")
    forged_role = auth.make_access_token(emp["id"], "admin")  # validly signed, wrong role
    assert api("GET", "/api/auth/me", token=forged_role).json["role"] == "employee"


def test_archived_employee_token_is_rejected(api, make_employee, login):
    emp = make_employee()
    token = login(emp)["access_token"]
    db.execute("UPDATE employees SET archived_at = now() WHERE id = %s", (str(emp["id"]),))
    resp = api("GET", "/api/auth/me", token=token)
    assert resp.status == 401 and resp.json["error"]["code"] == "invalid_token"


@pytest.mark.parametrize("sub", [str(uuid.uuid4()), "not-a-uuid"], ids=["missing-employee", "bad-sub"])
def test_token_for_a_missing_employee_is_rejected(api, sub):
    resp = api("GET", "/api/auth/me", token=auth.make_access_token(sub, "admin"))
    assert resp.status == 401 and resp.json["error"]["code"] == "invalid_token"


# =====================================================================
# require_role: deny by default
# =====================================================================
def test_require_role_allows_a_listed_role():
    assert rbac.require_role({"role": "manager"}, "admin", "manager") == "manager"


@pytest.mark.parametrize("employee, roles", [
    pytest.param({"role": "employee"}, ("admin", "manager"), id="role-not-listed"),
    pytest.param({"role": "admin"}, (), id="empty-allow-list"),
    pytest.param({"role": "superuser"}, ("superuser",), id="unknown-role"),
    pytest.param({}, ("admin",), id="no-role"),
])
def test_require_role_denies_by_default(employee, roles):
    with pytest.raises(Forbidden):
        rbac.require_role(employee or {"name": "x"}, *roles)


@pytest.mark.parametrize("employee", [None, "admin", []])
def test_require_role_without_an_employee_is_unauthorized(employee):
    with pytest.raises(Unauthorized):
        rbac.require_role(employee, "admin")
