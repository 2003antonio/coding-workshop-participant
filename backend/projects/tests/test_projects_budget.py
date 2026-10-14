"""GET /api/projects/{id}/budget: lines are admin-only, salary and rates never
reach a manager, and totals are hidden below MIN_AGGREGATE_GROUP people."""

import pytest

pytestmark = pytest.mark.integration


def budget_path(project):
    return f"/api/projects/{project['id']}/budget"


@pytest.fixture
def staffed(world, factory, migrated_db):
    """Billing gets a planned budget of 20000, a second allocation for e1 and one
    each for e2 and e3 (3 people)."""
    migrated_db.execute("UPDATE projects SET planned_budget = 20000 WHERE id = %s",
                        (str(world["billing"]["id"]),))
    w = dict(world)
    w["a1"] = migrated_db.query_one("SELECT id FROM allocations WHERE employee_id = %s",
                                    (str(world["e1"]["id"]),))
    w["a1b"] = factory.allocation(world["e1"], world["billing"], hours=10, start="2027-01-04", end="2027-01-15")
    w["a2"] = factory.allocation(world["e2"], world["billing"], hours=40, start="2026-11-02", end="2026-11-13")
    w["a3"] = factory.allocation(world["e3"], world["billing"], hours=5, start="2026-11-16", end="2026-11-20")
    return w


def _line(w, alloc, person, hours, weeks, rate, committed, used):
    return {"allocation_id": str(w[alloc]["id"]),
            "employee": {"id": str(w[person]["id"]), "name": w[person]["name"]},
            "hours_per_week": hours, "weeks": weeks, "hourly_rate": rate,
            "committed_cost": committed, "used_cost_to_date": used}


def test_admin_gets_lines_and_totals(api, staffed, today):
    w = staffed
    resp = api("GET", budget_path(w["billing"]), as_=w["admin"])
    assert resp.status == 200
    # e1: 104000/2080 = 50/h. 20h x 7 weeks = 7000 committed; 2 weeks used = 2000.
    #     10h x 2 weeks = 1000 committed, 0 used.
    # e2: 124800/2080 = 60/h, 40h x 2 weeks = 4800 committed and used.
    # e3: 83200/2080 = 40/h, 5h x 1 week = 200 committed, 0 used (starts next week).
    assert resp.json == {
        "project_id": str(w["billing"]["id"]),
        "planned_budget": 20000.0,
        "committed_cost": 13000.0,
        "used_cost_to_date": 6800.0,
        "allocated_people": 3,
        "hidden_reason": None,
        "lines": [   # by person, then start date
            _line(w, "a2", "e2", 40, 2, 60.0, 4800.0, 4800.0),
            _line(w, "a3", "e3", 5, 1, 40.0, 200.0, 0.0),
            _line(w, "a1", "e1", 20, 7, 50.0, 7000.0, 2000.0),
            _line(w, "a1b", "e1", 10, 2, 50.0, 1000.0, 0.0),
        ],
    }


def test_manager_gets_totals_only_at_three_people(api, staffed, today):
    resp = api("GET", budget_path(staffed["billing"]), as_=staffed["max"])
    assert resp.status == 200
    assert resp.json == {"project_id": str(staffed["billing"]["id"]), "planned_budget": 20000.0,
                         "committed_cost": 13000.0, "used_cost_to_date": 6800.0,
                         "allocated_people": 3, "hidden_reason": None}


def test_manager_gets_nulls_below_three_people_but_still_the_planned_budget(api, world, migrated_db, today):
    migrated_db.execute("UPDATE projects SET planned_budget = 20000 WHERE id = %s", (str(world["billing"]["id"]),))
    resp = api("GET", budget_path(world["billing"]), as_=world["max"])
    assert resp.json == {"project_id": str(world["billing"]["id"]), "planned_budget": 20000.0,
                         "committed_cost": None, "used_cost_to_date": None,
                         "allocated_people": 1, "hidden_reason": "below_min_group"}


def test_admin_always_gets_numbers(api, world, today):
    resp = api("GET", budget_path(world["billing"]), as_=world["admin"])
    assert resp.json["committed_cost"] == 7000.0 and resp.json["hidden_reason"] is None
    assert resp.json["planned_budget"] is None


def test_old_names_are_gone(api, staffed, today):
    body = api("GET", budget_path(staffed["billing"]), as_=staffed["admin"]).json
    for key in ("planned", "used", "remaining"):
        assert key not in body
        assert all(key not in line for line in body["lines"])


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
