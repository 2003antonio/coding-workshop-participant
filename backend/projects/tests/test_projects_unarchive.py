"""POST /api/projects/{id}/unarchive: admin or the team's manager, team must be active, audited."""

import uuid

import pytest

pytestmark = pytest.mark.integration


def p(project, suffix=""):
    return f"/api/projects/{project['id'] if isinstance(project, dict) else project}{suffix}"


def audit(db, action="project_unarchived"):
    return db.query("SELECT actor_id, entity_id, details FROM audit_log WHERE action = %s", (action,))


@pytest.mark.parametrize("who", ["admin", "max"])
def test_admin_and_the_teams_manager_unarchive(api, world, factory, migrated_db, who):
    factory.deliverable(world["billing"], name="Spec")
    assert api("POST", p(world["billing"], "/archive"), as_=world["max"]).status == 200
    resp = api("POST", p(world["billing"], "/unarchive"), as_=world[who])
    assert resp.status == 200
    assert resp.json["archived_at"] is None and resp.json["name"] == "Billing"
    rows = audit(migrated_db)
    assert [(r["actor_id"], r["entity_id"], r["details"]) for r in rows] == [
        (world[who]["id"], world["billing"]["id"], None)]
    # The deliverables archived with it come back; allocations stay archived.
    deliverables = api("GET", p(world["billing"], "/deliverables"), as_=world["admin"]).json["deliverables"]
    assert [d["name"] for d in deliverables] == ["Spec"]
    alloc = migrated_db.query_one("SELECT archived_at FROM allocations WHERE project_id = %s",
                                  (str(world["billing"]["id"]),))
    assert alloc["archived_at"] is not None


def test_a_deliverable_archived_earlier_stays_archived(api, world, factory):
    factory.deliverable(world["billing"], name="Old", archived=True)
    api("POST", p(world["billing"], "/archive"), as_=world["admin"])
    api("POST", p(world["billing"], "/unarchive"), as_=world["admin"])
    deliverables = api("GET", p(world["billing"], "/deliverables"), as_=world["admin"]).json["deliverables"]
    assert deliverables == []


def test_manager_of_another_team_gets_404_and_employee_403(api, world, factory, migrated_db):
    old = factory.project(world["platform"], "Old", archived=True)
    assert api("POST", p(old, "/unarchive"), as_=world["mia"]).status == 404
    assert api("POST", p(old, "/unarchive"), as_=world["e1"]).status == 403
    assert audit(migrated_db) == []
    assert api("GET", p(old), as_=world["admin"]).json["archived_at"] is not None


def test_not_archived_or_unknown_is_404(api, world):
    for target in (world["billing"], uuid.uuid4()):
        resp = api("POST", p(target, "/unarchive"), as_=world["admin"])
        assert resp.status == 404 and resp.code == "not_found"


def test_refused_while_its_team_is_archived(api, world, factory, migrated_db):
    gone = factory.team(world["mia"], "Gone", archived=True)
    old = factory.project(gone, "Orphan", archived=True)
    resp = api("POST", p(old, "/unarchive"), as_=world["admin"])
    assert resp.status == 409 and resp.code == "team_archived"
    assert "team is archived" in resp.json["error"]["message"]
    assert audit(migrated_db) == []


def test_manager_response_has_no_salary_figures(api, world, factory):
    old = factory.project(world["platform"], "Old", archived=True)
    body = api("POST", p(old, "/unarchive"), as_=world["max"]).json
    assert not {"salary", "hourly_rate", "weekly_cost"} & set(body)
