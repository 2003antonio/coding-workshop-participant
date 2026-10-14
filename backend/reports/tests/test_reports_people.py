"""Reports 2, 3 and 5: at-risk projects, resource allocation and near capacity."""

import pytest

pytestmark = pytest.mark.integration

BASE = "/api/reports"


def by_name(rows):
    return {r["name"]: r for r in rows}


# =====================================================================
# 2. At-risk projects
# =====================================================================
def test_at_risk_reasons(api, world):
    resp = api("GET", f"{BASE}/at-risk-projects", as_=world["admin"])
    assert resp.status == 200
    rows = by_name(resp.json["projects"])
    assert list(rows) == ["Old", "Billing", "Lake"]
    assert rows["Old"]["reasons"] == ["past_end_date", "unstaffed"]
    assert rows["Billing"]["reasons"] == ["overdue_deliverable", "blocked_past_start",
                                          "dependency_date_conflict"]
    assert rows["Lake"]["reasons"] == ["unstaffed"]      # its allocations start next week
    assert rows["Billing"]["manager"]["name"] == "Max Manager"


def test_projects_without_risks_are_not_listed(api, world, factory):
    calm = factory.project(world["data"], "Calm", status="planned")
    assert calm["name"] not in api("GET", f"{BASE}/at-risk-projects", as_=world["admin"]).text


def test_at_risk_scope_and_roles(api, world):
    assert [p["name"] for p in api("GET", f"{BASE}/at-risk-projects", as_=world["mia"]).json["projects"]] == ["Lake"]
    assert api("GET", f"{BASE}/at-risk-projects", as_=world["e1"]).status == 403


def test_over_budget_compares_committed_cost_with_the_planned_budget(api, world, migrated_db):
    # Billing commits 11000; Lake commits 5250.
    migrated_db.execute("UPDATE projects SET planned_budget = 10000 WHERE id = %s", (str(world["billing"]["id"]),))
    migrated_db.execute("UPDATE projects SET planned_budget = 6000 WHERE id = %s", (str(world["lake"]["id"]),))
    admin_rows = by_name(api("GET", f"{BASE}/at-risk-projects", as_=world["admin"]).json["projects"])
    assert admin_rows["Billing"]["reasons"][-1] == "over_budget"
    assert "over_budget" not in admin_rows["Lake"]["reasons"]
    # Admin only: a manager never gets this reason.
    max_rows = by_name(api("GET", f"{BASE}/at-risk-projects", as_=world["max"]).json["projects"])
    assert "over_budget" not in max_rows["Billing"]["reasons"]


def test_no_planned_budget_means_no_over_budget_reason(api, world):
    rows = by_name(api("GET", f"{BASE}/at-risk-projects", as_=world["admin"]).json["projects"])
    assert all("over_budget" not in r["reasons"] for r in rows.values())


# =====================================================================
# 3. Resource allocation
# =====================================================================
def test_default_window_is_twelve_weeks_from_this_monday(api, world):
    resp = api("GET", f"{BASE}/resource-allocation", as_=world["admin"])
    assert resp.status == 200
    assert resp.json["weeks"][0] == "2026-11-09" and len(resp.json["weeks"]) == 12
    assert resp.json["weeks"][-1] == "2027-01-25"


def test_manager_sees_members_and_hidden_projects_as_other_hours(api, world):
    resp = api("GET", f"{BASE}/resource-allocation", as_=world["max"])
    people = by_name(resp.json["people"])
    assert list(people) == ["Eli Two", "Emma Three", "Eve One"]
    eve_week = people["Eve One"]["weeks"][1]          # week of 2026-11-16
    assert eve_week == {"week_start": "2026-11-16", "total_hours": 35,
                        "projects": [{"id": str(world["billing"]["id"]), "name": "Billing", "hours": 20}],
                        "other_hours": 15}
    assert "Lake" not in resp.text and str(world["lake"]["id"]) not in resp.text
    assert people["Eve One"]["team_id"] == str(world["platform"]["id"])


def test_admin_sees_every_project_by_name(api, world):
    people = by_name(api("GET", f"{BASE}/resource-allocation", as_=world["admin"]).json["people"])
    assert len(people) == 7
    week = people["Eve One"]["weeks"][1]
    assert [p["name"] for p in week["projects"]] == ["Billing", "Lake"] and week["other_hours"] == 0


def test_employee_sees_only_themselves(api, world):
    resp = api("GET", f"{BASE}/resource-allocation", as_=world["e2"])
    assert [p["name"] for p in resp.json["people"]] == ["Eli Two"]
    assert resp.json["people"][0]["weeks"][0]["total_hours"] == 30


def test_window_and_team_filter(api, world):
    resp = api("GET", f"{BASE}/resource-allocation", as_=world["admin"],
               query=f"from=2026-12-02&to=2026-12-15&team_id={world['data']['id']}")
    assert resp.json["weeks"] == ["2026-11-30", "2026-12-07", "2026-12-14"]
    assert [p["name"] for p in resp.json["people"]] == ["Dan Data"]
    assert [w["total_hours"] for w in resp.json["people"][0]["weeks"]] == [20, 20, 20]


@pytest.mark.parametrize("query, expected_weeks", [("from=2026-12-02", 12), ("to=2026-12-02", 12),
                                                   ("from=2026-01-05&to=2027-01-03", 52)])
def test_window_defaults_and_limits(api, world, query, expected_weeks):
    resp = api("GET", f"{BASE}/resource-allocation", as_=world["admin"], query=query)
    assert resp.status == 200 and len(resp.json["weeks"]) == expected_weeks


@pytest.mark.parametrize("query", ["from=2026-12-02&to=2026-12-01", "from=2026-01-05&to=2027-01-04"])
def test_invalid_range(api, world, query):
    resp = api("GET", f"{BASE}/resource-allocation", as_=world["admin"], query=query)
    assert resp.status == 400 and resp.code == "invalid_range"


def test_bad_dates_are_400(api, world):
    resp = api("GET", f"{BASE}/resource-allocation", as_=world["admin"], query="from=soon")
    assert resp.status == 400 and resp.code == "bad_request"


# =====================================================================
# 5. Over-allocated ("near capacity")
# =====================================================================
def test_near_capacity_default_threshold(api, world):
    resp = api("GET", f"{BASE}/over-allocated", as_=world["max"])
    assert resp.status == 200
    assert resp.json == {"label": "near capacity", "threshold": 32, "people": [
        {"id": str(world["e1"]["id"]), "name": "Eve One",
         "weeks": [{"week_start": "2026-11-16", "total_hours": 35}]}]}


@pytest.mark.parametrize("threshold, names", [("34", ["Eve One"]), ("35", []), ("40", []), ("20", ["Eli Two", "Eve One"])])
def test_near_capacity_threshold(api, world, threshold, names):
    resp = api("GET", f"{BASE}/over-allocated", as_=world["admin"], query=f"threshold={threshold}")
    assert [p["name"] for p in resp.json["people"]] == names


@pytest.mark.parametrize("threshold", ["0", "41", "abc", "32.5", "-1", "100"])
def test_bad_threshold_is_400(api, world, threshold):
    resp = api("GET", f"{BASE}/over-allocated", as_=world["admin"], query=f"threshold={threshold}")
    assert resp.status == 400 and resp.code == "bad_request"


def test_near_capacity_roles(api, world):
    assert api("GET", f"{BASE}/over-allocated", as_=world["mia"]).json["people"] == []
    assert api("GET", f"{BASE}/over-allocated", as_=world["e1"]).status == 403
