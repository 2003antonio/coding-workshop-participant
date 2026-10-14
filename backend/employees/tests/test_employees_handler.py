"""The employees Lambda handler: routing, bodies, errors, and what gets logged."""

import base64
import logging
import uuid

import pytest

pytestmark = pytest.mark.integration


def _assert_error(resp, status, code):
    assert resp.status == status
    assert set(resp.json) == {"error"}
    assert resp.json["error"]["code"] == code
    assert "Traceback" not in resp.text


@pytest.mark.parametrize("path", ["/api/employees/", "/api/employees", "/"],
                         ids=["aws-style", "no-trailing-slash", "local-style"])
def test_list_works_with_and_without_the_service_prefix(api, staff, token_for, path):
    assert api("GET", path, token=token_for(staff["admin"])).status == 200


@pytest.mark.parametrize("method, path", [
    ("DELETE", "/api/employees/00000000-0000-0000-0000-000000000001"),
    ("PATCH", "/api/employees/00000000-0000-0000-0000-000000000001"),
    ("GET", "/api/employees/00000000-0000-0000-0000-000000000001/archive"),
    ("POST", "/api/employees/a/b/c"),
    ("GET", "/api/auth/me"),
])
def test_unknown_route_is_404(api, method, path):
    _assert_error(api(method, path), 404, "not_found")


def test_malformed_json_is_400(api, staff, token_for):
    resp = api("POST", "/api/employees/", token=token_for(staff["admin"]), raw_body='{"name": ')
    _assert_error(resp, 400, "bad_request")


def test_oversize_body_is_413(api, staff, token_for):
    big = '{"name": "' + "x" * (64 * 1024) + '"}'
    resp = api("POST", "/api/employees/", token=token_for(staff["admin"]), raw_body=big)
    _assert_error(resp, 413, "payload_too_large")


def test_base64_bodies_are_decoded_and_bad_ones_rejected(api, svc, staff, token_for, lambda_event):
    token = token_for(staff["admin"])
    event = lambda_event("PUT", f"/api/employees/{staff['employee']['id']}", token=token,
                       raw_body=base64.b64encode(b'{"name": "Eve B"}').decode())
    event["isBase64Encoded"] = True
    assert svc.function.handler(event, None)["statusCode"] == 200
    event["body"] = "%%% not base64 %%%"
    assert svc.function.handler(event, None)["statusCode"] == 400


def test_unexpected_error_is_a_generic_500_without_details(api, svc, staff, token_for,
                                                           monkeypatch, caplog):
    def explode(actor, include_archived):
        raise RuntimeError("salary=123456 leaked")

    monkeypatch.setattr(svc.services, "list_employees", explode)
    caplog.set_level(logging.INFO)
    resp = api("GET", "/api/employees/", token=token_for(staff["admin"]))
    _assert_error(resp, 500, "internal_error")
    assert "123456" not in resp.text and "123456" not in caplog.text
    assert "Unhandled RuntimeError on GET /" in caplog.text


def test_logs_hold_only_method_pattern_status_and_actor(api, staff, token_for, caplog):
    admin = staff["admin"]
    target = staff["employee"]
    caplog.set_level(logging.DEBUG)
    api("POST", "/api/employees/", token=token_for(admin),
        body={"name": "Nia New", "email": "nia@acme.test", "job_title": "Analyst",
              "role": "employee", "salary": 76543.21, "password": "Initial-Pass-2024"})
    api("PUT", f"/api/employees/{target['id']}", token=token_for(admin), body={"salary": 81234})
    api("GET", f"/api/employees/{target['id']}", token=token_for(admin))

    messages = [r.getMessage() for r in caplog.records]
    assert f"POST / -> 201 actor={admin['id']}" in messages
    assert f"PUT /{{id}} -> 200 actor={admin['id']}" in messages
    assert f"GET /{{id}} -> 200 actor={admin['id']}" in messages
    for secret in ("76543", "81234", "90000", "Initial-Pass-2024", "nia@acme.test",
                   str(target["id"])):
        assert secret not in caplog.text


def test_unknown_paths_are_not_logged_verbatim(api, caplog):
    caplog.set_level(logging.INFO)
    api("GET", "/api/employees/x/eyJhbGciOiJIUzI1NiJ9.pasted.token")
    assert "pasted" not in caplog.text
    assert "GET (unmatched) -> 404 actor=None" in caplog.text


def test_migrations_run_once_per_cold_start(api, svc, monkeypatch):
    calls = []
    monkeypatch.setattr(svc.function, "_migrated", False)
    monkeypatch.setattr(svc.function, "run_migrations", lambda: calls.append(1))
    api("GET", f"/api/employees/{uuid.uuid4()}")
    api("GET", "/api/employees/")
    assert calls == [1]
