"""The reports Lambda handler: routing, roles, errors and logs."""

import logging

import pytest

pytestmark = pytest.mark.integration

REPORTS = ["project-status", "at-risk-projects", "resource-allocation", "deliverable-status",
           "over-allocated", "dependency-chain", "budget", "activity"]


@pytest.mark.parametrize("report", REPORTS)
def test_every_report_needs_a_token(api, report):
    assert api("GET", f"/api/reports/{report}").status == 401


@pytest.mark.parametrize("report", REPORTS)
def test_reports_are_read_only(api, world, report):
    assert api("POST", f"/api/reports/{report}", as_=world["admin"], body={}).status == 404


def test_unknown_report_is_404(api, world):
    assert api("GET", "/api/reports/salaries", as_=world["admin"]).status == 404


def test_unexpected_error_is_a_generic_500(api, svc, world, monkeypatch, caplog):
    def explode(*args):
        raise RuntimeError("salary=104000")
    monkeypatch.setattr(svc.services, "budget_report", explode)
    caplog.set_level(logging.INFO)
    resp = api("GET", "/api/reports/budget", as_=world["admin"])
    assert resp.status == 500 and "104000" not in resp.text and "104000" not in caplog.text
    assert "Unhandled RuntimeError on GET /budget" in caplog.text


def test_bad_body_on_a_get_is_still_400(api, world):
    assert api("GET", "/api/reports/budget", as_=world["admin"], raw_body="{").status == 400


def test_base64_flag_with_a_bad_body(svc, world, lambda_event):
    event = lambda_event("GET", "/api/reports/budget", raw_body="%%%")
    event["isBase64Encoded"] = True
    assert svc.function.handler(event, None)["statusCode"] == 400
    event["body"] = "x" * (65 * 1024)
    event["isBase64Encoded"] = False
    assert svc.function.handler(event, None)["statusCode"] == 413


def test_migrations_run_once_per_cold_start(api, svc, monkeypatch):
    calls = []
    monkeypatch.setattr(svc.function, "_migrated", False)
    monkeypatch.setattr(svc.function, "run_migrations", lambda: calls.append(1))
    api("GET", "/api/reports/budget")
    api("GET", "/api/reports/budget")
    assert calls == [1]
