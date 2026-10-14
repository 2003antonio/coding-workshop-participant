"""GET /api/teams/, GET /{id}: who sees which team (docs/api-contract.md section 3)."""

import uuid

import pytest

pytestmark = pytest.mark.integration

LIST = "/api/teams/"


def one(team_id, suffix=""):
    return f"/api/teams/{team_id}{suffix}"


def names(resp):
    return [t["name"] for t in resp.json["teams"]]


def test_admin_sees_every_team_without_members_in_the_list(api, org):
    resp = api("GET", LIST, as_=org["admin"])
    assert resp.status == 200 and names(resp) == ["Data", "Platform"]
    platform = resp.json["teams"][1]
    assert platform == {"id": str(org["platform"]["id"]), "name": "Platform",
                        "lead": {"id": str(org["max"]["id"]), "name": "Max Manager"},
                        "member_count": 3, "archived_at": None}


def test_manager_sees_only_the_teams_they_lead(api, org, factory):
    factory.team(org["max"], "Second")
    assert names(api("GET", LIST, as_=org["max"])) == ["Platform", "Second"]
    assert names(api("GET", LIST, as_=org["mia"])) == ["Data"]


def test_employee_sees_only_their_own_team(api, org):
    assert names(api("GET", LIST, as_=org["e1"])) == ["Platform"]
    assert names(api("GET", LIST, as_=org["free"])) == []


def test_get_one_includes_members_and_never_salaries(api, org):
    resp = api("GET", one(org["platform"]["id"]), as_=org["e1"])
    assert resp.status == 200
    assert [m["name"] for m in resp.json["members"]] == ["Eli Two", "Emma Three", "Eve One"]
    assert set(resp.json["members"][0]) == {"id", "name", "job_title", "role"}
    assert "salary" not in resp.text and "100000" not in resp.text


@pytest.mark.parametrize("who, team", [("max", "data"), ("mia", "platform"), ("e1", "data"),
                                       ("free", "platform")])
def test_teams_the_caller_cannot_see_are_404(api, org, who, team):
    resp = api("GET", one(org[team]["id"]), as_=org[who])
    assert resp.status == 404 and resp.code == "not_found"


def test_unknown_and_malformed_ids_are_404(api, org):
    assert api("GET", one(uuid.uuid4()), as_=org["admin"]).status == 404
    assert api("GET", one("nope"), as_=org["admin"]).status == 404


def test_archived_teams_are_hidden_unless_an_admin_asks(api, org, factory):
    old = factory.team(org["mia"], "Old", archived=True)
    assert "Old" not in names(api("GET", LIST, as_=org["admin"]))
    assert "Old" in names(api("GET", LIST, as_=org["admin"], query="include_archived=true"))
    assert api("GET", LIST, as_=org["mia"], query="include_archived=true").status == 403
    assert api("GET", one(old["id"]), as_=org["admin"]).status == 200
    assert api("GET", one(old["id"]), as_=org["mia"]).status == 404


def test_archived_members_are_not_counted_or_listed(api, org, factory):
    factory.employee(name="Gone", team=org["platform"], archived=True)
    resp = api("GET", one(org["platform"]["id"]), as_=org["admin"])
    assert resp.json["member_count"] == 3 and "Gone" not in resp.text


def test_no_token_is_401(api, org):
    assert api("GET", LIST).status == 401
