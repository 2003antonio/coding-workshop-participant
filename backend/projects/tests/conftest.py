"""Test helpers for the projects service. Shared fixtures (call_service, factory,
today) live in backend/conftest.py."""

import pytest
from service_loader import load_service

PROJECTS = load_service("projects")


@pytest.fixture
def svc():
    return PROJECTS


@pytest.fixture
def api(call_service):
    """api("GET", "/api/projects/", as_=employee_row, body=..., query=...)."""
    return call_service(PROJECTS)


@pytest.fixture
def world(factory):
    """Max leads Platform (e1, e2, e3) with project Billing; Mia leads Data (d1)
    with project Lake. e1 is allocated to Billing."""
    w = {
        "admin": factory.employee("admin", name="Ada Admin", salary=200000),
        "max": factory.employee("manager", name="Max Manager", salary=150000),
        "mia": factory.employee("manager", name="Mia Manager", salary=140000),
        "e1": factory.employee(name="Eve One", salary=104000),
        "e2": factory.employee(name="Eli Two", salary=124800),
        "e3": factory.employee(name="Emma Three", salary=83200),
        "d1": factory.employee(name="Dan Data", salary=93600),
    }
    w["platform"] = factory.team(w["max"], "Platform", members=[w["e1"], w["e2"], w["e3"]])
    w["data"] = factory.team(w["mia"], "Data", members=[w["d1"]])
    w["billing"] = factory.project(w["platform"], "Billing", start="2026-11-02", end="2027-03-31")
    w["lake"] = factory.project(w["data"], "Lake", start="2026-11-02", end="2027-03-31")
    factory.allocation(w["e1"], w["billing"], hours=20, start="2026-11-02", end="2026-12-18")
    return w

