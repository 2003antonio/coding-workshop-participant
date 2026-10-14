"""GET /api/teams/{id}/budget: admin and the team's lead only; salaries never
reach a manager, and totals are hidden below MIN_AGGREGATE_GROUP members."""

import pytest

from common import budget

pytestmark = pytest.mark.integration


def path(team):
    return f"/api/teams/{team['id']}/budget"


def test_admin_gets_the_numbers(api, org):
    resp = api("GET", path(org["platform"]), as_=org["admin"])
    assert resp.status == 200
    # 100000 + 110000 + 120000; the lead's own salary is not included.
    assert resp.json == {"team_id": str(org["platform"]["id"]), "member_count": 3,
                         "yearly": 330000.0, "weekly": 6346.15, "hidden_reason": None}


def test_admin_gets_numbers_even_for_a_tiny_team(api, org):
    resp = api("GET", path(org["data"]), as_=org["admin"])
    assert resp.json["yearly"] == 90000.0 and resp.json["hidden_reason"] is None


def test_lead_gets_totals_at_the_minimum_group_size(api, org):
    resp = api("GET", path(org["platform"]), as_=org["max"])
    assert resp.status == 200 and resp.json["yearly"] == 330000.0
    assert resp.json["member_count"] == budget.MIN_AGGREGATE_GROUP


def test_lead_gets_nulls_below_the_minimum_group_size(api, org):
    resp = api("GET", path(org["data"]), as_=org["mia"])
    assert resp.status == 200
    assert resp.json == {"team_id": str(org["data"]["id"]), "member_count": 1,
                         "yearly": None, "weekly": None, "hidden_reason": "below_min_group"}
    assert "90000" not in resp.text


def test_hidden_as_soon_as_one_member_leaves(api, org):
    api("DELETE", f"/api/teams/{org['platform']['id']}/members/{org['e3']['id']}", as_=org["admin"])
    resp = api("GET", path(org["platform"]), as_=org["max"])
    assert resp.json["yearly"] is None and resp.json["hidden_reason"] == "below_min_group"


def test_members_cannot_see_their_teams_budget(api, org):
    resp = api("GET", path(org["platform"]), as_=org["e1"])
    assert resp.status == 403


def test_other_managers_get_404(api, org):
    assert api("GET", path(org["platform"]), as_=org["mia"]).status == 404


def test_salary_never_reaches_a_manager_through_any_team_endpoint(api, org):
    texts = [api("GET", "/api/teams/", as_=org["max"]).text,
             api("GET", f"/api/teams/{org['platform']['id']}", as_=org["max"]).text,
             api("GET", path(org["platform"]), as_=org["max"]).text]
    for text in texts:
        assert "salary" not in text and "hourly_rate" not in text
        for amount in ("100000", "110000", "120000"):
            assert amount not in text
