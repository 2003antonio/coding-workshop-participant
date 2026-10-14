"""Projects: visibility per role, create/update/archive rules (contract section 4)."""

import uuid

import pytest


pytestmark = pytest.mark.integration

LIST = "/api/projects/"


def p(project, suffix=""):
    return f"/api/projects/{project['id'] if isinstance(project, dict) else project}{suffix}"


def names(resp):
    return [x["name"] for x in resp.json["projects"]]


def new_project(team, **overrides):
    body = {"team_id": str(team["id"]), "name": "Mobile", "start_date": "2026-12-01",
            "end_date": "2027-02-26"}
    body.update(overrides)
    return body


# =====================================================================
# Visibility
# =====================================================================
def test_admin_sees_all_projects(api, world):
    resp = api("GET", LIST, as_=world["admin"])
    assert resp.status == 200 and names(resp) == ["Billing", "Lake"]
    billing = resp.json["projects"][0]
    assert billing == {
        "id": str(world["billing"]["id"]),
        "team": {"id": str(world["platform"]["id"]), "name": "Platform"},
        "manager": {"id": str(world["max"]["id"]), "name": "Max Manager"},
        "name": "Billing", "description": "", "status": "active",
        "start_date": "2026-11-02", "end_date": "2027-03-31", "archived_at": None,
        "planned_budget": None}


@pytest.mark.parametrize("who, visible", [
    ("max", ["Billing"]), ("mia", ["Lake"]), ("e1", ["Billing"]), ("e2", []), ("d1", []),
])
def test_each_role_sees_only_its_projects(api, world, who, visible):
    assert names(api("GET", LIST, as_=world[who])) == visible


@pytest.mark.parametrize("who, project", [("max", "lake"), ("mia", "billing"), ("e2", "billing"),
                                          ("d1", "lake")])
def test_hidden_projects_are_404_not_403(api, world, who, project):
    for suffix in ("", "/budget", "/deliverables"):
        resp = api("GET", p(world[project], suffix), as_=world[who])
        assert resp.status == 404 and resp.code == "not_found", suffix


def test_an_archived_allocation_does_not_give_visibility(api, world, factory):
    factory.allocation(world["e2"], world["billing"], start="2027-01-04", end="2027-01-08", archived=True)
    assert api("GET", p(world["billing"]), as_=world["e2"]).status == 404


def test_future_allocation_gives_visibility(api, world, factory):
    factory.allocation(world["e2"], world["billing"], start="2027-03-01", end="2027-03-05")
    assert api("GET", p(world["billing"]), as_=world["e2"]).status == 200


def test_filters(api, world, factory):
    factory.project(world["platform"], "Planned one", status="planned")
    admin = world["admin"]
    assert names(api("GET", LIST, as_=admin, query=f"team_id={world['data']['id']}")) == ["Lake"]
    assert names(api("GET", LIST, as_=admin, query="status=planned")) == ["Planned one"]
    assert api("GET", LIST, as_=admin, query="status=done").status == 400
    assert api("GET", LIST, as_=admin, query="team_id=nope").status == 400


def test_archived_projects_need_include_archived(api, world, factory):
    factory.project(world["platform"], "Old", archived=True)
    assert "Old" not in names(api("GET", LIST, as_=world["max"]))
    assert "Old" in names(api("GET", LIST, as_=world["max"], query="include_archived=true"))
    assert "Old" not in names(api("GET", LIST, as_=world["mia"], query="include_archived=true"))
    assert api("GET", LIST, as_=world["e1"], query="include_archived=true").status == 403


def test_manager_follows_the_team_lead(api, world, migrated_db):
    # Changing a team's lead changes the manager of all its projects at once.
    migrated_db.execute("UPDATE teams SET lead_id = %s WHERE id = %s",
                        (str(world["mia"]["id"]), str(world["platform"]["id"])))
    resp = api("GET", p(world["billing"]), as_=world["mia"])
    assert resp.status == 200 and resp.json["manager"]["name"] == "Mia Manager"
    assert api("GET", p(world["billing"]), as_=world["max"]).status == 404


def test_malformed_and_unknown_ids_are_404(api, world):
    assert api("GET", p("nope"), as_=world["admin"]).status == 404
    assert api("GET", p(uuid.uuid4()), as_=world["admin"]).status == 404


# =====================================================================
# Create
# =====================================================================
def test_admin_creates_a_project_with_default_status(api, world):
    resp = api("POST", LIST, as_=world["admin"], body=new_project(world["data"], description=" x "))
    assert resp.status == 201
    assert resp.json["status"] == "planned" and resp.json["description"] == "x"
    assert resp.json["manager"]["name"] == "Mia Manager"


def test_manager_creates_for_a_team_they_lead_only(api, world):
    assert api("POST", LIST, as_=world["max"], body=new_project(world["platform"])).status == 201
    resp = api("POST", LIST, as_=world["max"], body=new_project(world["data"]))
    assert resp.status == 403 and resp.code == "forbidden"


def test_employee_cannot_create(api, world):
    assert api("POST", LIST, as_=world["e1"], body=new_project(world["platform"])).status == 403


def test_invalid_team(api, world, factory):
    old = factory.team(world["mia"], "Old", archived=True)
    for team_id in (str(old["id"]), str(uuid.uuid4()), "nope"):
        resp = api("POST", LIST, as_=world["admin"], body=new_project(world["data"], team_id=team_id))
        assert resp.status == 400 and resp.code == "invalid_team"


def test_dates_must_be_in_order(api, world):
    resp = api("POST", LIST, as_=world["admin"],
               body=new_project(world["data"], start_date="2027-01-02", end_date="2027-01-01"))
    assert resp.status == 400 and resp.code == "invalid_dates"


@pytest.mark.parametrize("overrides", [
    {"name": ""}, {"name": "x" * 201}, {"description": "x" * 2001}, {"status": "Active"},
    {"start_date": "2026-13-01"}, {"end_date": None}, {"budget": 5}, {"description": 3},
])
def test_bad_create_bodies_are_400(api, world, overrides):
    resp = api("POST", LIST, as_=world["admin"], body=new_project(world["data"], **overrides))
    assert resp.status == 400 and resp.code == "bad_request"


# =====================================================================
# Update
# =====================================================================
def test_manager_updates_their_project(api, world):
    resp = api("PUT", p(world["billing"]), as_=world["max"],
               body={"name": "Billing v2", "status": "on_hold", "description": "New"})
    assert resp.status == 200
    assert (resp.json["name"], resp.json["status"], resp.json["description"]) == ("Billing v2", "on_hold", "New")


def test_update_permissions(api, world):
    assert api("PUT", p(world["billing"]), as_=world["mia"], body={"name": "X"}).status == 404
    assert api("PUT", p(world["billing"]), as_=world["e1"], body={"name": "X"}).status == 403


def test_only_admin_moves_a_project_to_another_team(api, world):
    body = {"team_id": str(world["data"]["id"])}
    assert api("PUT", p(world["billing"]), as_=world["max"], body=body).status == 403
    resp = api("PUT", p(world["billing"]), as_=world["admin"], body=body)
    assert resp.status == 200 and resp.json["team"]["name"] == "Data"


def test_shrinking_dates_around_work_is_409(api, world, factory):
    # e1's allocation runs to 2026-12-18.
    resp = api("PUT", p(world["billing"]), as_=world["max"], body={"end_date": "2026-12-01"})
    assert resp.status == 409 and resp.code == "dates_conflict"
    factory.deliverable(world["lake"], start="2026-11-10", due="2026-11-20")
    resp = api("PUT", p(world["lake"]), as_=world["mia"], body={"start_date": "2026-11-15"})
    assert resp.status == 409 and resp.code == "dates_conflict"
    resp = api("PUT", p(world["lake"]), as_=world["mia"], body={"start_date": "2026-11-09"})
    assert resp.status == 200


def test_update_dates_must_stay_in_order(api, world):
    resp = api("PUT", p(world["billing"]), as_=world["max"], body={"start_date": "2027-04-01"})
    assert resp.status == 400 and resp.code == "invalid_dates"


def test_completing_needs_every_deliverable_done(api, world, factory):
    d = factory.deliverable(world["lake"])
    resp = api("PUT", p(world["lake"]), as_=world["mia"], body={"status": "completed"})
    assert resp.status == 409 and resp.code == "deliverables_open"
    api("PUT", p(world["lake"], f"/deliverables/{d['id']}"), as_=world["mia"], body={"status": "done"})
    assert api("PUT", p(world["lake"]), as_=world["mia"], body={"status": "completed"}).status == 200


def test_empty_update_is_400_and_unchanged_update_is_ok(api, world, migrated_db):
    assert api("PUT", p(world["billing"]), as_=world["max"], body={}).status == 400
    assert api("PUT", p(world["billing"]), as_=world["max"], body={"name": "Billing"}).status == 200
    assert migrated_db.query("SELECT 1 FROM audit_log WHERE action = 'project_updated'") == []


def test_moving_to_an_archived_team_is_invalid(api, world, factory):
    old = factory.team(world["mia"], "Old", archived=True)
    resp = api("PUT", p(world["billing"]), as_=world["admin"], body={"team_id": str(old["id"])})
    assert resp.status == 400 and resp.code == "invalid_team"


# =====================================================================
# Archive
# =====================================================================
def test_archive_cascades_to_deliverables_and_allocations(api, world, factory, migrated_db):
    factory.deliverable(world["billing"])
    resp = api("POST", p(world["billing"], "/archive"), as_=world["max"])
    assert resp.status == 200 and resp.json["archived_at"] is not None
    for table in ("deliverables", "allocations"):
        rows = migrated_db.query("SELECT archived_at FROM " + table + " WHERE project_id = %s",
                                 (str(world["billing"]["id"]),))
        assert rows and all(r["archived_at"] is not None for r in rows), table
    again = api("POST", p(world["billing"], "/archive"), as_=world["max"])
    assert again.status == 409 and again.code == "already_archived"
    resp = api("PUT", p(world["billing"]), as_=world["max"], body={"name": "X"})
    assert resp.status == 409 and resp.code == "archived"
    # The employee lost visibility with their allocation.
    assert api("GET", p(world["billing"]), as_=world["e1"]).status == 404


def test_archive_permissions(api, world):
    assert api("POST", p(world["billing"], "/archive"), as_=world["e1"]).status == 403
    assert api("POST", p(world["billing"], "/archive"), as_=world["mia"]).status == 404


# =====================================================================
# Planned budget
# =====================================================================
def test_admin_and_manager_set_a_planned_budget(api, world):
    resp = api("POST", LIST, as_=world["admin"], body=new_project(world["data"], planned_budget=52000.5))
    assert resp.status == 201 and resp.json["planned_budget"] == 52000.5
    resp = api("PUT", p(world["billing"]), as_=world["max"], body={"planned_budget": 75000})
    assert resp.status == 200 and resp.json["planned_budget"] == 75000.0
    assert api("GET", p(world["billing"]), as_=world["max"]).json["planned_budget"] == 75000.0


def test_manager_sets_it_on_create(api, world):
    resp = api("POST", LIST, as_=world["max"], body=new_project(world["platform"], planned_budget=1000))
    assert resp.status == 201 and resp.json["planned_budget"] == 1000.0


def test_null_clears_it_and_absent_keeps_it(api, world):
    api("PUT", p(world["billing"]), as_=world["admin"], body={"planned_budget": 500})
    assert api("PUT", p(world["billing"]), as_=world["admin"], body={"name": "B2"}).json["planned_budget"] == 500.0
    resp = api("PUT", p(world["billing"]), as_=world["admin"], body={"planned_budget": None})
    assert resp.status == 200 and resp.json["planned_budget"] is None


def test_employees_never_see_the_planned_budget(api, world):
    api("PUT", p(world["billing"]), as_=world["admin"], body={"planned_budget": 123456})
    for path in (LIST, p(world["billing"])):
        resp = api("GET", path, as_=world["e1"])
        assert resp.status == 200 and "planned_budget" not in resp.text and "123456" not in resp.text


def test_employees_cannot_set_it(api, world):
    assert api("PUT", p(world["billing"]), as_=world["e1"], body={"planned_budget": 1}).status == 403


@pytest.mark.parametrize("value", [-1, 1.005, "1000", True, 10_000_000_000])
def test_planned_budget_validation(api, world, value):
    resp = api("PUT", p(world["billing"]), as_=world["admin"], body={"planned_budget": value})
    assert resp.status == 400 and resp.code == "bad_request"


def test_planned_budget_change_is_audited_by_field_name_only(api, world, migrated_db):
    api("PUT", p(world["billing"]), as_=world["max"], body={"planned_budget": 98765.43})
    rows = migrated_db.query("SELECT details FROM audit_log WHERE action = 'project_updated'")
    assert [r["details"] for r in rows] == [{"fields": ["planned_budget"]}]
    api("PUT", p(world["billing"]), as_=world["max"], body={"planned_budget": 98765.43})
    assert len(migrated_db.query("SELECT 1 FROM audit_log WHERE action = 'project_updated'")) == 1
