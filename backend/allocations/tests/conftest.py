"""Test helpers for the allocations service. Shared fixtures (call_service,
factory, today) live in backend/conftest.py."""

import pytest
from service_loader import load_service

ALLOCATIONS = load_service("allocations")


@pytest.fixture
def svc():
    return ALLOCATIONS


@pytest.fixture
def api(call_service):
    """api("GET", "/api/allocations/", as_=employee_row, body=..., query=...)."""
    return call_service(ALLOCATIONS)


@pytest.fixture
def world(factory):
    """Max leads Platform (e1, e2) with projects Billing and Search; Mia leads
    Data (d1) with project Lake. e1 already works 20 h/week on Billing."""
    w = {
        "admin": factory.employee("admin", name="Ada Admin", salary=200000),
        "max": factory.employee("manager", name="Max Manager", salary=150000),
        "mia": factory.employee("manager", name="Mia Manager", salary=140000),
        "e1": factory.employee(name="Eve One", salary=104000),
        "e2": factory.employee(name="Eli Two", salary=124800),
        "d1": factory.employee(name="Dan Data", salary=93600),
    }
    w["platform"] = factory.team(w["max"], "Platform", members=[w["e1"], w["e2"]])
    w["data"] = factory.team(w["mia"], "Data", members=[w["d1"]])
    w["billing"] = factory.project(w["platform"], "Billing", start="2026-11-02", end="2027-03-31")
    w["search"] = factory.project(w["platform"], "Search", start="2026-11-02", end="2027-03-31")
    w["lake"] = factory.project(w["data"], "Secret Lake", start="2026-11-02", end="2027-03-31")
    w["a1"] = factory.allocation(w["e1"], w["billing"], hours=20, start="2026-11-02", end="2026-12-18")
    return w


@pytest.fixture
def new():
    """new(world, employee="e2", project="billing", **overrides) -> a POST body."""
    return _new


def _new(w, employee="e2", project="billing", **overrides):
    body = {"employee_id": str(w[employee]["id"]), "project_id": str(w[project]["id"]),
            "hours_per_week": 20, "start_date": "2026-11-02", "end_date": "2026-11-27"}
    body.update(overrides)
    return body
