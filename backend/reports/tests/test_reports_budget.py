"""Report 7: budget used vs planned. Salary never reaches a manager, no
per-person lines, and totals hidden below MIN_AGGREGATE_GROUP."""

import pytest

pytestmark = pytest.mark.integration

URL = "/api/reports/budget"


def by_name(rows):
    return {r["name"]: r for r in rows}


def test_admin_gets_every_number(api, world):
    resp = api("GET", URL, as_=world["admin"])
    assert resp.status == 200
    projects, teams = by_name(resp.json["projects"]), by_name(resp.json["teams"])
    # Billing: e1 20h x 7 wk x 50 = 7000 (used 2 wk = 2000); e2 30h x 2 wk x 60 = 3600
    # (used 1 wk = 1800); e3 10h x 1 wk x 40 = 400 (used 400).
    assert projects["Billing"] == {"id": str(world["billing"]["id"]), "name": "Billing",
                                   "team": {"id": str(world["platform"]["id"]), "name": "Platform"},
                                   "planned": 11000.0, "used": 4200.0, "remaining": 6800.0,
                                   "percent_used": 38.2, "hidden_reason": None}
    # Lake: e1 15h x 1 wk x 50 = 750; d1 20h x 5 wk x 45 = 4500; nothing used yet.
    assert (projects["Lake"]["planned"], projects["Lake"]["used"]) == (5250.0, 0.0)
    assert projects["Old"]["planned"] == 0.0 and projects["Old"]["percent_used"] == 0.0
    assert teams["Platform"] == {"id": str(world["platform"]["id"]), "name": "Platform",
                                 "weekly": 6000.0, "yearly": 312000.0, "hidden_reason": None}
    assert teams["Data"]["yearly"] == 93600.0


def test_manager_sees_totals_only_for_groups_of_three(api, world):
    resp = api("GET", URL, as_=world["max"])
    projects, teams = by_name(resp.json["projects"]), by_name(resp.json["teams"])
    assert list(projects) == ["Old", "Billing"] and list(teams) == ["Platform"]
    assert projects["Billing"]["planned"] == 11000.0 and projects["Billing"]["hidden_reason"] is None
    # Old has nobody allocated: hidden, not zero.
    assert projects["Old"]["planned"] is None and projects["Old"]["hidden_reason"] == "below_min_group"
    assert teams["Platform"]["yearly"] == 312000.0


def test_small_groups_are_hidden_from_their_manager(api, world):
    resp = api("GET", URL, as_=world["mia"])
    lake = by_name(resp.json["projects"])["Lake"]
    assert lake == {"id": str(world["lake"]["id"]), "name": "Lake",
                    "team": {"id": str(world["data"]["id"]), "name": "Data"},
                    "planned": None, "used": None, "remaining": None, "percent_used": None,
                    "hidden_reason": "below_min_group"}
    data = by_name(resp.json["teams"])["Data"]
    assert data["weekly"] is None and data["yearly"] is None and data["hidden_reason"] == "below_min_group"
    for amount in ("93600", "5250", "4500", "750"):
        assert amount not in resp.text


def test_no_lines_or_salaries_even_for_admin(api, world):
    for who in ("admin", "max", "mia"):
        text = api("GET", URL, as_=world[who]).text
        for word in ("lines", "salary", "hourly_rate", "104000", "124800"):
            assert word not in text, (who, word)


def test_team_filter_and_roles(api, world):
    resp = api("GET", URL, as_=world["admin"], query=f"team_id={world['data']['id']}")
    assert [p["name"] for p in resp.json["projects"]] == ["Lake"]
    assert [t["name"] for t in resp.json["teams"]] == ["Data"]
    assert api("GET", URL, as_=world["e1"]).status == 403


def test_salary_never_reaches_a_manager_through_any_report(api, world):
    queries = ["project-status", "at-risk-projects", "resource-allocation", "deliverable-status",
               "over-allocated", f"dependency-chain?project_id={world['billing']['id']}", "budget"]
    for report in queries:
        path, _, query = report.partition("?")
        text = api("GET", f"/api/reports/{path}", as_=world["max"], query=query).text
        for word in ("salary", "hourly_rate", "weekly_cost", "104000", "124800", "83200"):
            assert word not in text, (report, word)
