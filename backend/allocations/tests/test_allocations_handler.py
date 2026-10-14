"""The allocations Lambda handler: routing, bodies, errors and logs."""

import logging

import pytest

pytestmark = pytest.mark.integration


def test_unknown_route_and_bad_bodies(api, world):
    assert api("DELETE", "/api/allocations/", as_=world["admin"]).status == 404
    assert api("POST", "/api/allocations/", as_=world["admin"], raw_body="{").status == 400
    assert api("POST", "/api/allocations/", as_=world["admin"], raw_body="x" * (65 * 1024)).status == 413


def test_base64_body(svc, world, lambda_event):
    import base64
    from common import auth
    event = lambda_event("PUT", f"/api/allocations/{world['a1']['id']}",
                         token=auth.make_access_token(world["max"]["id"], "manager"),
                         raw_body=base64.b64encode(b'{"hours_per_week": 10}').decode())
    event["isBase64Encoded"] = True
    assert svc.function.handler(event, None)["statusCode"] == 200
    event["body"] = "%%%"
    assert svc.function.handler(event, None)["statusCode"] == 400


def test_unexpected_error_is_a_generic_500(api, svc, world, monkeypatch, caplog):
    def explode(*args, **kwargs):
        raise RuntimeError("rate=50.0")
    monkeypatch.setattr(svc.services, "list_allocations", explode)
    caplog.set_level(logging.INFO)
    resp = api("GET", "/api/allocations/", as_=world["admin"])
    assert resp.status == 500 and "50.0" not in resp.text and "rate=" not in caplog.text


def test_logs_show_patterns_not_ids(api, world, caplog):
    caplog.set_level(logging.INFO)
    api("GET", f"/api/allocations/{world['a1']['id']}", as_=world["max"])
    assert f"GET /{{id}} -> 200 actor={world['max']['id']}" in caplog.text
    assert str(world["a1"]["id"]) not in caplog.text


def test_migrations_run_once_per_cold_start(api, svc, monkeypatch):
    calls = []
    monkeypatch.setattr(svc.function, "_migrated", False)
    monkeypatch.setattr(svc.function, "run_migrations", lambda: calls.append(1))
    api("GET", "/api/allocations/")
    api("GET", "/api/allocations/")
    assert calls == [1]
