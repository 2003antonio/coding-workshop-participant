"""POST/PUT /api/teams, members, archive: admin only, and the lead/member rules."""

import uuid

import pytest

from common import db

pytestmark = pytest.mark.integration

LIST = "/api/teams/"


def one(team_id, suffix=""):
    return f"/api/teams/{team_id}{suffix}"


def members_of(resp):
    return sorted(m["name"] for m in resp.json["members"])


def audit_actions(prefix="team_"):
    rows = db.query("SELECT action, details FROM audit_log WHERE action LIKE %s ORDER BY created_at",
                    (prefix + "%",))
    return [(r["action"], r["details"]) for r in rows]


# =====================================================================
# Permissions per role
# =====================================================================
@pytest.mark.parametrize("who", ["max", "e1"])
@pytest.mark.parametrize("method, suffix, body", [
    ("POST", None, {"name": "New", "lead_id": None}),
    ("PUT", "", {"name": "Renamed"}),
    ("POST", "/members", {"employee_id": None}),
    ("DELETE", "/members/{e1}", None),
    ("POST", "/archive", None),
])
def test_only_admins_change_teams(api, org, who, method, suffix, body):
    if body and "lead_id" in body:
        body = dict(body, lead_id=str(org["mia"]["id"]))
    if body and "employee_id" in body:
        body = dict(body, employee_id=str(org["free"]["id"]))
    path = LIST if suffix is None else one(org["platform"]["id"], suffix.format(e1=org["e1"]["id"]))
    resp = api(method, path, as_=org[who], body=body)
    assert resp.status == 403 and resp.code == "forbidden"
    assert audit_actions() == []


# =====================================================================
# Create / update
# =====================================================================
def test_admin_creates_a_team(api, org):
    resp = api("POST", LIST, as_=org["admin"], body={"name": "  Mobile ", "lead_id": str(org["mia"]["id"])})
    assert resp.status == 201
    assert resp.json["name"] == "Mobile" and resp.json["members"] == []
    assert resp.json["lead"] == {"id": str(org["mia"]["id"]), "name": "Mia Manager"}
    assert audit_actions() == [("team_created", None)]


def test_an_admin_can_lead_a_team(api, org):
    resp = api("POST", LIST, as_=org["admin"], body={"name": "Ops", "lead_id": str(org["admin"]["id"])})
    assert resp.status == 201


@pytest.mark.parametrize("lead", ["e1", "gone", "missing", "not-a-uuid"])
def test_lead_must_be_an_active_manager_or_admin(api, org, factory, lead):
    lead_ids = {"e1": str(org["e1"]["id"]), "missing": str(uuid.uuid4()), "not-a-uuid": "x",
                "gone": str(factory.employee("manager", archived=True)["id"])}
    resp = api("POST", LIST, as_=org["admin"], body={"name": "Ops", "lead_id": lead_ids[lead]})
    assert resp.status == 400 and resp.code == "invalid_lead"


def test_duplicate_active_name_in_any_case_is_409(api, org, factory):
    resp = api("POST", LIST, as_=org["admin"], body={"name": "PLATFORM", "lead_id": str(org["mia"]["id"])})
    assert resp.status == 409 and resp.code == "name_taken"
    resp = api("PUT", one(org["data"]["id"]), as_=org["admin"], body={"name": "platform"})
    assert resp.status == 409 and resp.code == "name_taken"
    factory.team(org["mia"], "Legacy", archived=True)
    resp = api("POST", LIST, as_=org["admin"], body={"name": "legacy", "lead_id": str(org["mia"]["id"])})
    assert resp.status == 201


@pytest.mark.parametrize("body", [
    pytest.param({}, id="empty"),
    pytest.param({"name": "  "}, id="blank"),
    pytest.param({"name": "x" * 201}, id="too-long"),
    pytest.param({"name": "A", "members": []}, id="unknown-field"),
    pytest.param({"lead_id": 5}, id="lead-not-string"),
])
def test_bad_update_bodies_are_400(api, org, body):
    resp = api("PUT", one(org["platform"]["id"]), as_=org["admin"], body=body)
    assert resp.status == 400 and resp.code == "bad_request"


def test_create_requires_name_and_lead(api, org):
    for body in ({"name": "X"}, {"lead_id": str(org["mia"]["id"])}, [], {"name": "X", "lead_id": None}):
        assert api("POST", LIST, as_=org["admin"], body=body).status == 400


def test_rename_and_change_lead(api, org):
    resp = api("PUT", one(org["platform"]["id"]), as_=org["admin"],
               body={"name": "Core", "lead_id": str(org["mia"]["id"])})
    assert resp.status == 200
    assert resp.json["name"] == "Core" and resp.json["lead"]["name"] == "Mia Manager"
    assert sorted(a for a, _ in audit_actions()) == ["team_lead_changed", "team_updated"]


def test_unchanged_update_writes_no_audit(api, org):
    resp = api("PUT", one(org["platform"]["id"]), as_=org["admin"],
               body={"name": "Platform", "lead_id": str(org["max"]["id"])})
    assert resp.status == 200 and audit_actions() == []


def test_a_member_cannot_be_named_lead(api, org, factory):
    member_manager = factory.employee("manager", team=org["platform"])
    resp = api("PUT", one(org["platform"]["id"]), as_=org["admin"],
               body={"lead_id": str(member_manager["id"])})
    assert resp.status == 409 and resp.code == "lead_cannot_be_member"


def test_a_member_of_another_team_can_lead_this_one(api, org, factory):
    other_team_manager = factory.employee("manager", team=org["data"])
    resp = api("PUT", one(org["platform"]["id"]), as_=org["admin"],
               body={"lead_id": str(other_team_manager["id"])})
    assert resp.status == 200


def test_update_unknown_or_archived_team(api, org, factory):
    old = factory.team(org["mia"], "Old", archived=True)
    assert api("PUT", one(uuid.uuid4()), as_=org["admin"], body={"name": "X"}).status == 404
    resp = api("PUT", one(old["id"]), as_=org["admin"], body={"name": "X"})
    assert resp.status == 409 and resp.code == "archived"


def test_rename_race_is_still_a_409(svc, org, monkeypatch):
    # Another team takes the name between the check and the update: the unique index answers.
    monkeypatch.setattr(svc.repository, "name_taken", lambda name, team_id: False)
    from common.errors import Conflict
    with pytest.raises(Conflict) as exc:
        svc.services.update_team(org["admin"], str(org["data"]["id"]), {"name": "platform"})
    assert exc.value.code == "name_taken"


def test_other_database_errors_on_update_are_not_hidden(svc, org, monkeypatch):
    import pg8000.dbapi
    with pytest.raises(pg8000.dbapi.DatabaseError):
        svc.repository.update_team(str(org["data"]["id"]), "x" * 10, "not-a-uuid")


# =====================================================================
# Members
# =====================================================================
def test_add_and_remove_a_member(api, org):
    path = one(org["platform"]["id"], "/members")
    resp = api("POST", path, as_=org["admin"], body={"employee_id": str(org["free"]["id"])})
    assert resp.status == 200 and "Fay Free" in members_of(resp) and resp.json["member_count"] == 4
    resp = api("DELETE", f"{path}/{org['free']['id']}", as_=org["admin"])
    assert resp.status == 200 and "Fay Free" not in members_of(resp)
    assert [a for a, _ in audit_actions()] == ["team_member_added", "team_member_removed"]
    assert audit_actions()[0][1] == {"employee_id": str(org["free"]["id"])}


@pytest.mark.parametrize("who, status, code", [
    ("e1", 409, "already_member"),
    ("d1", 409, "on_other_team"),
    ("max", 409, "lead_cannot_be_member"),
])
def test_member_rules(api, org, who, status, code):
    resp = api("POST", one(org["platform"]["id"], "/members"), as_=org["admin"],
               body={"employee_id": str(org[who]["id"])})
    assert resp.status == status and resp.code == code


def test_archived_unknown_or_malformed_employee_is_invalid(api, org, factory):
    gone = factory.employee(archived=True)
    for employee_id in (str(gone["id"]), str(uuid.uuid4()), "x"):
        resp = api("POST", one(org["platform"]["id"], "/members"), as_=org["admin"],
                   body={"employee_id": employee_id})
        assert resp.status == 400 and resp.code == "invalid_employee"


def test_removing_a_non_member_is_404(api, org):
    resp = api("DELETE", one(org["platform"]["id"], f"/members/{org['d1']['id']}"), as_=org["admin"])
    assert resp.status == 404
    resp = api("DELETE", one(org["platform"]["id"], f"/members/{uuid.uuid4()}"), as_=org["admin"])
    assert resp.status == 404


def test_removal_keeps_existing_allocations(api, org, factory, migrated_db):
    project = factory.project(org["platform"])
    factory.allocation(org["e1"], project)
    api("DELETE", one(org["platform"]["id"], f"/members/{org['e1']['id']}"), as_=org["admin"])
    row = migrated_db.query_one("SELECT archived_at FROM allocations WHERE employee_id = %s",
                                (str(org["e1"]["id"]),))
    assert row == {"archived_at": None}


def test_members_of_an_archived_team_cannot_change(api, org, factory):
    old = factory.team(org["mia"], "Old", archived=True)
    resp = api("POST", one(old["id"], "/members"), as_=org["admin"], body={"employee_id": str(org["free"]["id"])})
    assert resp.status == 409 and resp.code == "archived"


# =====================================================================
# Archive
# =====================================================================
def test_archive_clears_members_and_hides_the_team(api, org, migrated_db):
    resp = api("POST", one(org["data"]["id"], "/archive"), as_=org["admin"])
    assert resp.status == 200 and resp.json["archived_at"] is not None and resp.json["members"] == []
    row = migrated_db.query_one("SELECT team_id FROM employees WHERE id = %s", (str(org["d1"]["id"]),))
    assert row == {"team_id": None}
    assert "Data" not in [t["name"] for t in api("GET", "/api/teams/", as_=org["admin"]).json["teams"]]
    again = api("POST", one(org["data"]["id"], "/archive"), as_=org["admin"])
    assert again.status == 409 and again.code == "already_archived"


def test_a_team_with_active_projects_cannot_be_archived(api, org, factory):
    factory.project(org["data"], archived=True)
    live = factory.project(org["platform"])
    assert live
    resp = api("POST", one(org["platform"]["id"], "/archive"), as_=org["admin"])
    assert resp.status == 409 and resp.code == "has_active_projects"
    assert api("POST", one(org["data"]["id"], "/archive"), as_=org["admin"]).status == 200


def test_archive_unknown_team_is_404(api, org):
    assert api("POST", one(uuid.uuid4(), "/archive"), as_=org["admin"]).status == 404
