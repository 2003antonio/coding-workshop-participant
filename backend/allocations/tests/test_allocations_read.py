"""GET /api/allocations: visibility per role, filters, and rates for admin only."""

import uuid

import pytest

pytestmark = pytest.mark.integration

LIST = "/api/allocations/"
BASE_KEYS = {"id", "employee", "project", "hours_per_week", "start_date", "end_date", "archived_at"}


@pytest.fixture
def more(world, factory):
    factory.allocation(world["d1"], world["lake"], hours=10, start="2026-11-02", end="2026-11-06")
    factory.allocation(world["e2"], world["search"], hours=8, start="2027-01-04", end="2027-01-29")
    factory.allocation(world["e2"], world["billing"], hours=8, start="2026-11-02", end="2026-11-06",
                       archived=True)
    return world


def people(resp):
    return sorted((a["employee"]["name"], a["project"]["name"]) for a in resp.json["allocations"])


def test_admin_sees_everything_with_rate_and_cost(api, more):
    resp = api("GET", LIST, as_=more["admin"])
    assert resp.status == 200 and len(resp.json["allocations"]) == 3
    e1 = [a for a in resp.json["allocations"] if a["employee"]["name"] == "Eve One"][0]
    assert e1 == {"id": str(more["a1"]["id"]),
                  "employee": {"id": str(more["e1"]["id"]), "name": "Eve One"},
                  "project": {"id": str(more["billing"]["id"]), "name": "Billing"},
                  "hours_per_week": 20, "start_date": "2026-11-02", "end_date": "2026-12-18",
                  "archived_at": None, "hourly_rate": 50.0, "weekly_cost": 1000.0}


def test_manager_sees_their_teams_projects_without_rates(api, more):
    resp = api("GET", LIST, as_=more["max"])
    assert people(resp) == [("Eli Two", "Search"), ("Eve One", "Billing")]
    assert all(set(a) == BASE_KEYS for a in resp.json["allocations"])
    for word in ("hourly_rate", "weekly_cost", "salary", "104000", "50.0"):
        assert word not in resp.text
    assert people(api("GET", LIST, as_=more["mia"])) == [("Dan Data", "Secret Lake")]


def test_employee_sees_only_their_own(api, more):
    assert people(api("GET", LIST, as_=more["e2"])) == [("Eli Two", "Search")]
    assert api("GET", LIST, as_=more["e2"], query=f"employee_id={more['e1']['id']}").json == {"allocations": []}
    assert api("GET", LIST, as_=more["e2"], query="include_archived=true").status == 403


def test_filters(api, more):
    admin = more["admin"]
    assert people(api("GET", LIST, as_=admin, query=f"project_id={more['search']['id']}")) == [("Eli Two", "Search")]
    assert people(api("GET", LIST, as_=admin, query=f"employee_id={more['d1']['id']}")) == [("Dan Data", "Secret Lake")]
    # from/to keep allocations that overlap the window.
    assert people(api("GET", LIST, as_=admin, query="from=2026-12-01&to=2026-12-31")) == [("Eve One", "Billing")]
    assert len(api("GET", LIST, as_=admin, query="include_archived=true").json["allocations"]) == 4
    for bad in ("from=2026-13-01", "project_id=x", "include_archived=yes"):
        assert api("GET", LIST, as_=admin, query=bad).status == 400


@pytest.mark.parametrize("who, status", [("admin", 200), ("max", 200), ("e1", 200), ("mia", 404), ("e2", 404)])
def test_get_one_visibility(api, world, who, status):
    assert api("GET", f"{LIST}{world['a1']['id']}", as_=world[who]).status == status


def test_get_unknown_or_malformed_is_404(api, world):
    assert api("GET", f"{LIST}{uuid.uuid4()}", as_=world["admin"]).status == 404
    assert api("GET", f"{LIST}nope", as_=world["admin"]).status == 404
