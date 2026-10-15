"""The Lambda handler: event shape, body limits, errors, logging, cold start."""

import json
import logging

import pytest

pytestmark = pytest.mark.integration

_ERROR_KEYS = {"code", "message"}


def _assert_error(resp, status, code):
    assert resp.status == status
    assert set(resp.json) == {"error"}
    assert set(resp.json["error"]) == _ERROR_KEYS
    assert resp.json["error"]["code"] == code
    assert "Traceback" not in resp.text


# =====================================================================
# Routing and prefix stripping
# =====================================================================
@pytest.mark.parametrize("path", ["/api/auth/login", "/login", "/api/auth/login/"],
                         ids=["aws-style", "local-style", "trailing-slash"])
def test_login_works_with_and_without_the_service_prefix(api, make_employee, path):
    emp = make_employee()
    resp = api("POST", path, body={"email": emp["email"], "password": emp["password"]})
    assert resp.status == 200


@pytest.mark.parametrize("method, path", [
    ("GET", "/api/auth/nope"),
    ("POST", "/api/auth/"),
    ("GET", "/api/auth/login"),
    ("DELETE", "/api/auth/me"),
    ("GET", "/api/projects/me"),
])
def test_unknown_route_is_404(api, method, path):
    _assert_error(api(method, path), 404, "not_found")


# =====================================================================
# Bodies
# =====================================================================
def test_malformed_json_is_400(api):
    _assert_error(api("POST", "/api/auth/login", raw_body='{"email": "a@b.c",'), 400, "bad_request")


def test_empty_body_is_400(api):
    _assert_error(api("POST", "/api/auth/login"), 400, "bad_request")


def test_oversize_body_is_413(api):
    big = '{"email": "a@b.c", "password": "' + "x" * (64 * 1024) + '"}'
    _assert_error(api("POST", "/api/auth/login", raw_body=big), 413, "payload_too_large")


def test_oversize_base64_body_is_413(api):
    big = '{"pad": "' + "x" * (64 * 1024) + '"}'
    _assert_error(api("POST", "/api/auth/login", raw_body=big, base64_body=True),
                  413, "payload_too_large")


def test_base64_encoded_body_is_decoded(api, make_employee):
    emp = make_employee()
    resp = api("POST", "/api/auth/login",
               body={"email": emp["email"], "password": emp["password"]}, base64_body=True)
    assert resp.status == 200


def test_invalid_base64_body_is_400(api, lambda_event):
    import function
    event = lambda_event("POST", "/api/auth/login")
    event.update(body="%%% not base64 %%%", isBase64Encoded=True)
    resp = function.handler(event, None)
    assert resp["statusCode"] == 400


def test_non_utf8_body_is_400(api, lambda_event):
    import base64

    import function
    event = lambda_event("POST", "/api/auth/login")
    event.update(body=base64.b64encode(b"\xff\xfe\xfd").decode(), isBase64Encoded=True)
    assert function.handler(event, None)["statusCode"] == 400


# =====================================================================
# Errors and logging
# =====================================================================
def test_unexpected_error_is_a_generic_500_without_details(api, monkeypatch, caplog):
    import services

    def explode(email, password):
        raise RuntimeError("secret internal detail")

    monkeypatch.setattr(services, "login", explode)
    caplog.set_level(logging.INFO)
    resp = api("POST", "/api/auth/login", body={"email": "a@acme.test", "password": "pw-123"})
    _assert_error(resp, 500, "internal_error")
    assert resp.json["error"]["message"] == "Internal server error."
    assert "secret internal detail" not in resp.text
    assert "secret internal detail" not in caplog.text
    assert "Traceback" not in caplog.text
    assert "Unhandled RuntimeError on POST /login" in caplog.text


def test_log_lines_hold_only_method_route_status_and_actor(api, make_employee, login, caplog):
    emp = make_employee()
    caplog.set_level(logging.DEBUG)
    tokens = login(emp)
    api("GET", "/api/auth/me", token=tokens["access_token"])
    api("POST", "/api/auth/login", body={"email": emp["email"], "password": "wrong-pass-1"})

    messages = [r.getMessage() for r in caplog.records]
    assert f"POST /login -> 200 actor={emp['id']}" in messages
    assert f"GET /me -> 200 actor={emp['id']}" in messages
    assert f"POST /login -> 401 actor={emp['id']}" in messages
    for secret in (emp["password"], "wrong-pass-1", emp["email"],
                   tokens["access_token"], tokens["refresh_token"]):
        assert secret not in caplog.text


def test_unknown_paths_are_not_logged_verbatim(api, caplog):
    caplog.set_level(logging.INFO)
    api("GET", "/api/auth/eyJhbGciOiJIUzI1NiJ9.pasted.token")
    assert "pasted" not in caplog.text
    assert "GET (unmatched) -> 404 actor=None" in caplog.text


def test_migrations_run_once_per_cold_start(api, monkeypatch):
    import function
    calls = []
    monkeypatch.setattr(function, "_migrated", False)
    monkeypatch.setattr(function, "run_migrations", lambda: calls.append(1))
    api("GET", "/api/auth/me")
    api("GET", "/api/auth/me")
    assert calls == [1]


# =====================================================================
# Direct invoke: seed_demo (operator only, never through the public URL)
# =====================================================================
_SEED_PASSWORDS = {"admin": "Seed-Admin-Pass-1", "manager": "Seed-Manager-Pass-2",
                   "employee": "Seed-Employee-Pass-3"}


def _employee_count():
    from common import db
    return db.query_one("SELECT count(*) AS n FROM employees")["n"]


def test_direct_invoke_seeds_the_demo_once(migrated_db, caplog):
    import function
    from common import auth, db

    caplog.set_level(logging.DEBUG)
    first = function.handler({"action": "seed_demo", "passwords": _SEED_PASSWORDS}, None)
    assert first["ok"] is True and first["seeded"] is True
    assert first["counts"]["employees"] == _employee_count() == 11
    assert {"role": "admin", "email": "admin@acme-demo.test"} in first["accounts"]
    admin = db.query_one("SELECT password_hash FROM employees WHERE email = 'admin@acme-demo.test'")
    assert auth.verify_password(_SEED_PASSWORDS["admin"], admin["password_hash"])

    again = function.handler({"action": "seed_demo", "passwords": _SEED_PASSWORDS}, None)
    assert again["ok"] is True and again["seeded"] is False
    assert _employee_count() == 11
    for secret in _SEED_PASSWORDS.values():
        assert secret not in caplog.text
        assert secret not in json.dumps(first) + json.dumps(again)


@pytest.mark.parametrize("passwords", [
    None,
    "Seed-Admin-Pass-1",
    {"admin": "Seed-Admin-Pass-1", "manager": "Seed-Manager-Pass-2"},
    dict(_SEED_PASSWORDS, employee="short"),
    dict(_SEED_PASSWORDS, manager=123456789012345),
], ids=["missing", "not-a-map", "role-missing", "too-short", "not-text"])
def test_direct_invoke_refuses_bad_passwords_and_writes_nothing(migrated_db, passwords):
    import function
    result = function.handler({"action": "seed_demo", "passwords": passwords}, None)
    assert result["ok"] is False and "12 characters" in result["error"]
    assert _employee_count() == 0


def test_direct_invoke_unknown_action_does_nothing(migrated_db):
    import function
    result = function.handler({"action": "drop_everything"}, None)
    assert result == {"ok": False, "error": "Unknown action; the only one is seed_demo."}
    assert _employee_count() == 0


def test_direct_invoke_failure_logs_only_the_error_type(migrated_db, monkeypatch, caplog):
    import function
    from common import demo_seed

    def explode(passwords, monday=None):
        raise RuntimeError("secret internal detail")

    monkeypatch.setattr(demo_seed, "seed", explode)
    caplog.set_level(logging.INFO)
    result = function.handler({"action": "seed_demo", "passwords": _SEED_PASSWORDS}, None)
    assert result["ok"] is False and "RuntimeError" in result["error"]
    assert "secret internal detail" not in caplog.text + json.dumps(result)
    assert "direct invoke seed_demo -> unhandled RuntimeError" in caplog.text


@pytest.mark.parametrize("where", ["top-level", "body"])
def test_function_url_requests_cannot_reach_the_seed(api, lambda_event, where):
    import function
    payload = {"action": "seed_demo", "passwords": _SEED_PASSWORDS}
    if where == "body":
        resp = api("POST", "/api/auth/", body=payload)
        status = resp.status
    else:
        event = dict(lambda_event("POST", "/api/auth/seed_demo"), **payload)
        status = function.handler(event, None)["statusCode"]
    assert status == 404
    assert _employee_count() == 0


def test_direct_invoke_bulk_adds_the_large_demo_once(migrated_db, caplog):
    import function
    caplog.set_level(logging.DEBUG)
    event = {"action": "seed_demo", "passwords": _SEED_PASSWORDS, "bulk": True}
    first = function.handler(event, None)
    assert first["ok"] is True and first["seeded"] is True
    assert first["bulk"]["seeded"] is True and first["bulk"]["counts"]["employees"] == 500
    assert _employee_count() == 511

    again = function.handler(event, None)
    assert again["bulk"] == {"seeded": False, "message": "Large demo already present; nothing changed."}
    assert _employee_count() == 511
    for secret in _SEED_PASSWORDS.values():
        assert secret not in caplog.text + json.dumps(first) + json.dumps(again)


@pytest.mark.parametrize("flag", [None, False, "true", 1])
def test_direct_invoke_bulk_needs_literal_true(migrated_db, flag):
    import function
    event = {"action": "seed_demo", "passwords": _SEED_PASSWORDS}
    if flag is not None:
        event["bulk"] = flag
    result = function.handler(event, None)
    assert "bulk" not in result and _employee_count() == 11


def test_direct_invoke_reset_starts_the_demo_over(migrated_db):
    import function
    from common import db
    event = {"action": "seed_demo", "passwords": _SEED_PASSWORDS}
    function.handler(event, None)
    db.execute("UPDATE projects SET name = 'renamed' WHERE name = 'Billing v2'")
    result = function.handler(dict(event, reset=True), None)
    assert result["ok"] is True and result["seeded"] is True and _employee_count() == 11
    assert db.query_one("SELECT count(*) AS n FROM projects WHERE name = 'Billing v2'")["n"] == 1


def test_direct_invoke_reset_refuses_when_real_accounts_exist(migrated_db, make_employee):
    import function
    make_employee()  # an account outside the demo domain
    result = function.handler({"action": "seed_demo", "passwords": _SEED_PASSWORDS, "reset": True}, None)
    assert result == {"ok": False, "error": "Refusing to reset: the database has 1 account(s) "
                                            "outside @acme-demo.test."}
    assert _employee_count() == 1
