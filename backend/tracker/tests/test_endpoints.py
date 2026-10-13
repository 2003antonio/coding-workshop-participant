"""Integration tests for the endpoints, run against the test database."""

import base64
import json

import pytest

import function
import router
from auth import services as auth_services
from common import db
from common.errors import NotFound, Unauthorized


def _event(method, path, body=None, headers=None, b64=False):
    ev = {"requestContext": {"http": {"method": method}}, "rawPath": path,
          "headers": headers or {}}
    if body is not None:
        raw = body if isinstance(body, str) else json.dumps(body)
        if b64:
            ev["body"] = base64.b64encode(raw.encode()).decode()
            ev["isBase64Encoded"] = True
        else:
            ev["body"] = raw
    return ev


def _call(method, path, body=None, headers=None, b64=False):
    resp = function.handler(_event(method, path, body, headers, b64))
    parsed = json.loads(resp["body"]) if resp["body"] else None
    return resp["statusCode"], parsed


# --- login ---
def test_login_success(make_employee):
    make_employee(email="a@acme.test", password="pw-123456")
    status, data = _call("POST", "/api/tracker/auth/login",
                         {"email": "a@acme.test", "password": "pw-123456"})
    assert status == 200
    assert data["access_token"] and data["refresh_token"]
    assert "password_hash" not in json.dumps(data)


def test_login_wrong_password(make_employee):
    make_employee(email="a@acme.test", password="pw-123456")
    status, data = _call("POST", "/api/tracker/auth/login",
                         {"email": "a@acme.test", "password": "WRONG"})
    assert status == 401
    assert data["error"]["code"] == "invalid_credentials"


def test_login_unknown_email_same_error():
    status, data = _call("POST", "/api/tracker/auth/login",
                         {"email": "nobody@acme.test", "password": "whatever"})
    assert status == 401
    assert data["error"]["code"] == "invalid_credentials"


def test_login_archived_rejected(make_employee):
    make_employee(email="gone@acme.test", password="pw-123456", archived=True)
    status, data = _call("POST", "/api/tracker/auth/login",
                         {"email": "gone@acme.test", "password": "pw-123456"})
    assert status == 401
    assert data["error"]["code"] == "invalid_credentials"


def test_lockout_after_five_failures(make_employee):
    emp = make_employee(email="lock@acme.test", password="pw-123456")
    for _ in range(5):
        _call("POST", "/api/tracker/auth/login",
              {"email": "lock@acme.test", "password": "WRONG"})
    row = db.query_one("SELECT failed_attempts, locked_until FROM employees WHERE id=%s",
                       (emp["id"],))
    assert row["failed_attempts"] >= 5
    assert row["locked_until"] is not None
    # Even the correct password is rejected while locked, with the same error.
    status, data = _call("POST", "/api/tracker/auth/login",
                         {"email": "lock@acme.test", "password": "pw-123456"})
    assert status == 401
    assert data["error"]["code"] == "invalid_credentials"


# --- refresh rotation + reuse ---
def test_refresh_rotation(make_employee):
    make_employee(email="r@acme.test", password="pw-123456")
    _, login = _call("POST", "/api/tracker/auth/login",
                     {"email": "r@acme.test", "password": "pw-123456"})
    old = login["refresh_token"]
    status, data = _call("POST", "/api/tracker/auth/refresh", {"refresh_token": old})
    assert status == 200
    assert data["refresh_token"] != old  # rotated


def test_refresh_reuse_revokes_chain(make_employee):
    emp = make_employee(email="reuse@acme.test", password="pw-123456")
    _, login = _call("POST", "/api/tracker/auth/login",
                     {"email": "reuse@acme.test", "password": "pw-123456"})
    old = login["refresh_token"]
    _, rotated = _call("POST", "/api/tracker/auth/refresh", {"refresh_token": old})
    new = rotated["refresh_token"]
    # Present the already-used old token again -> reuse detected.
    status, data = _call("POST", "/api/tracker/auth/refresh", {"refresh_token": old})
    assert status == 401
    # The whole chain is revoked, so the "new" token no longer works either.
    status2, _ = _call("POST", "/api/tracker/auth/refresh", {"refresh_token": new})
    assert status2 == 401
    active = db.query_one(
        "SELECT count(*) AS n FROM refresh_tokens WHERE employee_id=%s AND revoked_at IS NULL",
        (emp["id"],))
    assert active["n"] == 0


# --- logout ---
def test_logout_revokes(make_employee):
    make_employee(email="lo@acme.test", password="pw-123456")
    _, login = _call("POST", "/api/tracker/auth/login",
                     {"email": "lo@acme.test", "password": "pw-123456"})
    rt = login["refresh_token"]
    status, _ = _call("POST", "/api/tracker/auth/logout", {"refresh_token": rt})
    assert status == 204
    # The revoked token can no longer be refreshed.
    status2, _ = _call("POST", "/api/tracker/auth/refresh", {"refresh_token": rt})
    assert status2 == 401


# --- /employees/me ---
def test_me_returns_sanitized_record(make_employee):
    make_employee(email="me@acme.test", password="pw-123456", role="manager")
    _, login = _call("POST", "/api/tracker/auth/login",
                     {"email": "me@acme.test", "password": "pw-123456"})
    status, data = _call("GET", "/api/tracker/employees/me",
                         headers={"authorization": "Bearer " + login["access_token"]})
    assert status == 200
    assert data["email"] == "me@acme.test"
    for hidden in ("password_hash", "failed_attempts", "locked_until", "salary"):
        assert hidden not in data


def test_me_role_comes_from_database_not_token(make_employee):
    emp = make_employee(email="elev@acme.test", password="pw-123456", role="employee")
    _, login = _call("POST", "/api/tracker/auth/login",
                     {"email": "elev@acme.test", "password": "pw-123456"})
    # Token says employee. Now flip the DB role to admin behind its back.
    db.execute("UPDATE employees SET role='admin' WHERE id=%s", (emp["id"],))
    current = auth_services.authenticate({"authorization": "Bearer " + login["access_token"]})
    assert current["role"] == "admin"  # from the DB row, not the (employee) token


# --- routing & request limits ---
def test_unknown_route_404():
    status, data = _call("GET", "/api/tracker/nope")
    assert status == 404
    assert data["error"]["code"] == "not_found"


def test_malformed_json_400():
    status, data = _call("POST", "/api/tracker/auth/login", "{not valid json")
    assert status == 400
    assert data["error"]["code"] == "bad_request"


def test_oversized_body_400():
    big = "x" * (64 * 1024 + 1)
    status, data = _call("POST", "/api/tracker/auth/login", big)
    assert status == 400


def test_base64_body_handled(make_employee):
    make_employee(email="b64@acme.test", password="pw-123456")
    status, data = _call("POST", "/api/tracker/auth/login",
                         {"email": "b64@acme.test", "password": "pw-123456"}, b64=True)
    assert status == 200


def test_path_normalization_both_forms():
    assert router.normalize_path("/api/tracker/auth/login") == "/auth/login"
    assert router.normalize_path("/auth/login") == "/auth/login"
    assert router.normalize_path("/api/tracker") == "/"


def test_dispatch_both_path_forms(make_employee):
    make_employee(email="p@acme.test", password="pw-123456")
    for path in ("/api/tracker/auth/login", "/auth/login"):
        status, data = _call("POST", path,
                             {"email": "p@acme.test", "password": "pw-123456"})
        assert status == 200
