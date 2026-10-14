"""Test helpers for the teams service. Shared fixtures (call_service, factory,
today) live in backend/conftest.py; the service is loaded in isolation because
other services have modules with the same names."""

import pytest
from service_loader import load_service

TEAMS = load_service("teams")


@pytest.fixture
def svc():
    return TEAMS


@pytest.fixture
def api(call_service):
    """api("GET", "/api/teams/", as_=employee_row, body=..., query=...)."""
    return call_service(TEAMS)


@pytest.fixture
def org(factory):
    """An admin; manager Max leads Platform (3 members); Mia leads Data (1 member);
    one employee on no team."""
    org = {
        "admin": factory.employee("admin", name="Ada Admin", salary=200000),
        "max": factory.employee("manager", name="Max Manager", salary=150000),
        "mia": factory.employee("manager", name="Mia Manager", salary=140000),
        "e1": factory.employee(name="Eve One", salary=100000),
        "e2": factory.employee(name="Eli Two", salary=110000),
        "e3": factory.employee(name="Emma Three", salary=120000),
        "d1": factory.employee(name="Dan Data", salary=90000),
        "free": factory.employee(name="Fay Free", salary=80000),
    }
    org["platform"] = factory.team(org["max"], "Platform", members=[org["e1"], org["e2"], org["e3"]])
    org["data"] = factory.team(org["mia"], "Data", members=[org["d1"]])
    return org
