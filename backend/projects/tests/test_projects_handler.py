"""The projects Lambda handler: routing, bodies, errors and logs."""

import logging

import pytest

pytestmark = pytest.mark.integration


def test_unknown_route_is_404(api, world):
    assert api("DELETE", f"/api/projects/{world['billing']['id']}", as_=world["admin"]).status == 404


def test_malformed_json_and_oversize(api, world):
    assert api("POST", "/api/projects/", as_=world["admin"], raw_body="{").status == 400
    assert api("POST", "/api/projects/", as_=world["admin"], raw_body="x" * (65 * 1024)).status == 413


def test_base64_body(svc, world, lambda_event):
    import base64
    from common import auth
    event = lambda_event("PUT", f"/api/projects/{world['billing']['id']}",
                         token=auth.make_access_token(world["max"]["id"], "manager"),
                         raw_body=base64.b64encode(b'{"name": "B"}').decode())
    event["isBase64Encoded"] = True
    assert svc.function.handler(event, None)["statusCode"] == 200
    event["body"] = "%%%"
    assert svc.function.handler(event, None)["statusCode"] == 400


def test_unexpected_error_is_a_generic_500(api, svc, world, monkeypatch, caplog):
    def explode(*args):
        raise RuntimeError("salary=104000")
    monkeypatch.setattr(svc.services, "project_budget", explode)
    caplog.set_level(logging.INFO)
    resp = api("GET", f"/api/projects/{world['billing']['id']}/budget", as_=world["admin"])
    assert resp.status == 500 and "104000" not in resp.text and "104000" not in caplog.text
    assert "Unhandled RuntimeError on GET /{id}/budget" in caplog.text


def test_logs_show_patterns_not_ids(api, world, caplog):
    caplog.set_level(logging.INFO)
    api("GET", f"/api/projects/{world['billing']['id']}/deliverables", as_=world["admin"])
    assert "GET /{id}/deliverables -> 200" in caplog.text
    assert str(world["billing"]["id"]) not in caplog.text


def test_migrations_run_once_per_cold_start(api, svc, monkeypatch):
    calls = []
    monkeypatch.setattr(svc.function, "_migrated", False)
    monkeypatch.setattr(svc.function, "run_migrations", lambda: calls.append(1))
    api("GET", "/api/projects/")
    api("GET", "/api/projects/")
    assert calls == [1]
