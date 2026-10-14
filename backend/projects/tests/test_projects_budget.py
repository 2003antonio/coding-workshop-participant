"""GET /api/projects/{id}/budget: lines are admin-only, salary and rates never
reach a manager, and totals are hidden below MIN_AGGREGATE_GROUP people."""

import pytest

pytestmark = pytest.mark.integration


def budget_path(project):
    return f"/api/projects/{project['id']}/budget"


@pytest.fixture
def staffed(world, factory):
    """Billing gets a second allocation for e1 and one each for e2 and e3 (3 people)."""
    factory.allocation(world["e1"], world["billing"], hours=10, start="2027-01-04", end="2027-01-15")
    factory.allocation(world["e2"], world["billing"], hours=40, start="2026-11-02", end="2026-11-13")
    factory.allocation(world["e3"], world["billing"], hours=5, start="2026-11-16", end="2026-11-20")
    return world


def test_admin_gets_lines_and_totals(api, staffed, today):
    resp = api("GET", budget_path(staffed["billing"]), as_=staffed["admin"])
    assert resp.status == 200
    body = resp.json
    # e1: 104000/2080 = 50/h. 20h x 7 weeks = 7000 planned; 2 weeks used = 2000.
    #     10h x 2 weeks = 1000 planned, 0 used.
    # e2: 124800/2080 = 60/h, 40h x 2 weeks = 4800 planned and used.
    # e3: 83200/2080 = 40/h, 5h x 1 week = 200 planned, 0 used (starts next week).
    assert (body["planned"], body["used"], body["remaining"]) == (13000.0, 6800.0, 6200.0)
    assert body["allocated_people"] == 3 and body["hidden_reason"] is None
    e1_line = [x for x in body["lines"] if x["employee"]["name"] == "Eve One" and x["weeks"] == 7][0]
    assert e1_line["hourly_rate"] == 50.0 and e1_line["planned"] == 7000.0 and e1_line["used"] == 2000.0
    assert len(body["lines"]) == 4


def test_manager_gets_totals_only_at_three_people(api, staffed, today):
    resp = api("GET", budget_path(staffed["billing"]), as_=staffed["max"])
    assert resp.status == 200
    assert "lines" not in resp.json
    assert resp.json["planned"] == 13000.0 and resp.json["hidden_reason"] is None


def test_manager_gets_nulls_below_three_people(api, world, today):
    resp = api("GET", budget_path(world["billing"]), as_=world["max"])
    assert resp.json == {"project_id": str(world["billing"]["id"]), "planned": None, "used": None,
                         "remaining": None, "allocated_people": 1, "hidden_reason": "below_min_group"}


def test_admin_always_gets_numbers(api, world, today):
    resp = api("GET", budget_path(world["billing"]), as_=world["admin"])
    assert resp.json["planned"] == 7000.0 and resp.json["hidden_reason"] is None


def test_salary_and_rates_never_reach_a_manager(api, staffed, today):
    text = api("GET", budget_path(staffed["billing"]), as_=staffed["max"]).text
    for word in ("salary", "hourly_rate", "lines", "104000", "124800", "83200", "50.0", "60.0"):
        assert word not in text


def test_employees_and_other_managers_cannot_see_it(api, world):
    assert api("GET", budget_path(world["billing"]), as_=world["e1"]).status == 403
    assert api("GET", budget_path(world["billing"]), as_=world["mia"]).status == 404


def test_archived_allocations_do_not_count(api, world, factory, today):
    factory.allocation(world["e2"], world["billing"], archived=True)
    assert api("GET", budget_path(world["billing"]), as_=world["admin"]).json["allocated_people"] == 1
