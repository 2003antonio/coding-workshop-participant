"""Test helpers for the employees service: call the real Lambda handler with
Function URL-shaped events. Shared DB fixtures live in backend/conftest.py.

The service is loaded with scripts/service_loader.py, not by putting its folder
on sys.path: the auth tests run in the same process and have modules with the
same names (function, routes, services, repository).
"""

import json

import pytest
from service_loader import load_service

from common import auth

EMPLOYEES = load_service("employees")


def make_event(method, path, body=None, token=None, query="", raw_body=None):
    """Build a Lambda Function URL (payload v2) event."""
    headers = {"content-type": "application/json"}
    if token is not None:
        headers["authorization"] = f"Bearer {token}"
    if raw_body is None and body is not None:
        raw_body = json.dumps(body)
    return {
        "version": "2.0",
        "rawPath": path,
        "rawQueryString": query,
        "headers": headers,
        "requestContext": {"http": {"method": method, "path": path}},
        "body": raw_body,
        "isBase64Encoded": False,
    }


class Response:
    def __init__(self, raw):
        self.raw = raw
        self.status = raw["statusCode"]
        self.text = raw.get("body") or ""
        self.json = json.loads(self.text) if self.text else None


@pytest.fixture
def lambda_event():
    """The make_event builder, for tests that call the handler directly."""
    return make_event


@pytest.fixture
def svc():
    """The employees service modules: svc.function, svc.routes, svc.services, svc.repository."""
    return EMPLOYEES


@pytest.fixture
def api(migrated_db):
    """Call the employees handler: api("GET", "/api/employees/", token=..., query="...")."""
    def _call(method, path, **kwargs):
        return Response(EMPLOYEES.function.handler(make_event(method, path, **kwargs), None))

    return _call


@pytest.fixture
def token_for():
    """A valid access token for an employee row (as the auth service would issue)."""
    return lambda employee: auth.make_access_token(employee["id"], employee["role"])


@pytest.fixture
def staff(make_employee):
    """One active admin, manager and employee with distinct salaries."""
    return {
        "admin": make_employee(email="ada@acme.test", name="Ada Admin", role="admin",
                               job_title="Head of Ops", salary=150000),
        "manager": make_employee(email="max@acme.test", name="Max Manager", role="manager",
                                 job_title="Delivery Lead", salary=120000),
        "employee": make_employee(email="eve@acme.test", name="Eve Employee", role="employee",
                                  job_title="Engineer", salary=90000),
    }


@pytest.fixture
def audit_rows(migrated_db):
    """Return audit_log rows (action, actor_id, entity_id, details), oldest first."""
    def _rows(action_prefix="employee_"):
        return migrated_db.query(
            "SELECT action, actor_id, entity_id, details FROM audit_log "
            "WHERE action LIKE %s ORDER BY created_at, action",
            (action_prefix + "%",),
        )

    return _rows
