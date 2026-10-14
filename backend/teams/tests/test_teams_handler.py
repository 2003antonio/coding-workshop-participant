"""The teams Lambda handler: routing, bodies, errors and logs."""

import logging

import pytest

pytestmark = pytest.mark.integration


def test_unknown_route_is_404(api, org):
    assert api("PATCH", "/api/teams/", as_=org["admin"]).status == 404


def test_malformed_json_is_400_and_oversize_is_413(api, org):
    assert api("POST", "/api/teams/", as_=org["admin"], raw_body="{").status == 400
    big = '{"name": "' + "x" * (64 * 1024) + '"}'
    assert api("POST", "/api/teams/", as_=org["admin"], raw_body=big).status == 413


def test_base64_body(svc, org, lambda_event):
    import base64
    from common import auth
    event = lambda_event("POST", "/api/teams/", token=auth.make_access_token(org["admin"]["id"], "admin"),
                       raw_body=base64.b64encode(b'{"name": "B64", "lead_id": "%s"}'
                                                 % str(org["mia"]["id"]).encode()).decode())
    event["isBase64Encoded"] = True
    assert svc.function.handler(event, None)["statusCode"] == 201
    event["body"] = "%%%"
    assert svc.function.handler(event, None)["statusCode"] == 400


def test_unexpected_error_is_a_generic_500(api, svc, org, monkeypatch, caplog):
    def explode(*args):
        raise RuntimeError("secret detail")
    monkeypatch.setattr(svc.services, "list_teams", explode)
    caplog.set_level(logging.INFO)
    resp = api("GET", "/api/teams/", as_=org["admin"])
    assert resp.status == 500 and "secret" not in resp.text and "secret" not in caplog.text
    assert "Unhandled RuntimeError on GET /" in caplog.text


def test_logs_show_the_pattern_not_the_id(api, org, caplog):
    caplog.set_level(logging.INFO)
    api("GET", f"/api/teams/{org['platform']['id']}", as_=org["admin"])
    assert f"GET /{{id}} -> 200 actor={org['admin']['id']}" in caplog.text
    assert str(org["platform"]["id"]) not in caplog.text


def test_migrations_run_once_per_cold_start(api, svc, monkeypatch):
    calls = []
    monkeypatch.setattr(svc.function, "_migrated", False)
    monkeypatch.setattr(svc.function, "run_migrations", lambda: calls.append(1))
    api("GET", "/api/teams/")
    api("GET", "/api/teams/")
    assert calls == [1]
