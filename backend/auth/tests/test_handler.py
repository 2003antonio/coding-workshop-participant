"""The Lambda handler: event shape, body limits, errors, logging, cold start."""

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
