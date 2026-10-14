"""Deliverables: CRUD, dates, the start rule and dependencies (contract section 5)."""

import uuid

import pytest

pytestmark = pytest.mark.integration


def d_path(project, deliverable=None, suffix=""):
    base = f"/api/projects/{project['id']}/deliverables"
    return base if deliverable is None else f"{base}/{deliverable['id'] if isinstance(deliverable, dict) else deliverable}{suffix}"


def new(**overrides):
    body = {"name": "API spec", "start_date": "2026-11-02", "due_date": "2026-11-20"}
    body.update(overrides)
    return body


@pytest.fixture
def chain(world, factory):
    """Billing: spec -> build -> launch (build depends on spec, launch on build)."""
    spec = factory.deliverable(world["billing"], "Spec", start="2026-11-02", due="2026-11-13")
    build = factory.deliverable(world["billing"], "Build", start="2026-11-16", due="2026-12-11",
                                depends_on=[spec])
    launch = factory.deliverable(world["billing"], "Launch", start="2026-12-14", due="2026-12-18",
                                 depends_on=[build])
    return dict(world, spec=spec, build=build, launch=launch)


def put(api, w, deliverable, body, who="max", suffix=""):
    return api("PUT", d_path(w["billing"], deliverable, suffix), as_=w[who], body=body)


# =====================================================================
# Read
# =====================================================================
def test_list_shape_and_flags(api, chain, today):
    resp = api("GET", d_path(chain["billing"]), as_=chain["e1"])
    assert resp.status == 200
    rows = {d["name"]: d for d in resp.json["deliverables"]}
    assert list(rows) == ["Spec", "Build", "Launch"]   # by due date
    assert set(rows["Spec"]) == {"id", "project_id", "name", "description", "start_date", "due_date",
                                 "status", "completed_at", "depends_on", "blocked", "overdue", "archived_at"}
    assert rows["Build"]["depends_on"] == [str(chain["spec"]["id"])]
    assert rows["Build"]["blocked"] is True and rows["Spec"]["blocked"] is False
    assert all(r["overdue"] is False for r in rows.values())


def test_overdue_when_due_date_passed_and_not_done(api, world, factory, today):
    factory.deliverable(world["billing"], "Late", start="2026-11-02", due="2026-11-10")
    factory.deliverable(world["billing"], "Late but done", start="2026-11-02", due="2026-11-10", status="done")
    rows = {d["name"]: d for d in api("GET", d_path(world["billing"]), as_=world["max"]).json["deliverables"]}
    assert rows["Late"]["overdue"] is True and rows["Late but done"]["overdue"] is False


def test_get_one_and_404s(api, chain):
    assert api("GET", d_path(chain["billing"], chain["spec"]), as_=chain["e1"]).json["name"] == "Spec"
    assert api("GET", d_path(chain["billing"], uuid.uuid4()), as_=chain["max"]).status == 404
    assert api("GET", d_path(chain["billing"], "nope"), as_=chain["max"]).status == 404
    # A deliverable of another project is not found under this one.
    assert api("GET", d_path(chain["lake"], chain["spec"]), as_=chain["admin"]).status == 404
    assert api("GET", d_path(chain["billing"], chain["spec"]), as_=chain["e2"]).status == 404


def test_archived_deliverables_are_hidden_from_employees(api, world, factory):
    old = factory.deliverable(world["billing"], "Old", archived=True)
    assert "Old" not in api("GET", d_path(world["billing"]), as_=world["max"]).text
    assert "Old" in api("GET", d_path(world["billing"]), as_=world["max"], query="include_archived=true").text
    assert api("GET", d_path(world["billing"]), as_=world["e1"], query="include_archived=true").status == 403
    assert api("GET", d_path(world["billing"], old), as_=world["e1"]).status == 404
    assert api("GET", d_path(world["billing"], old), as_=world["max"]).status == 200


# =====================================================================
# Create / update
# =====================================================================
def test_manager_creates_with_dependencies(api, chain):
    resp = api("POST", d_path(chain["billing"]), as_=chain["max"],
               body=new(name="Docs", depends_on=[str(chain["spec"]["id"]), str(chain["spec"]["id"])]))
    assert resp.status == 201
    assert resp.json["status"] == "not_started" and resp.json["depends_on"] == [str(chain["spec"]["id"])]


@pytest.mark.parametrize("who, status", [("e1", 403), ("mia", 404), ("admin", 201)])
def test_who_may_create(api, world, who, status):
    assert api("POST", d_path(world["billing"]), as_=world[who], body=new()).status == status


@pytest.mark.parametrize("dates", [
    {"start_date": "2026-11-20", "due_date": "2026-11-19"},   # reversed
    {"start_date": "2026-10-30"},                              # before the project
    {"due_date": "2027-04-01"},                                # after the project
])
def test_dates_must_fit_the_project(api, world, dates):
    resp = api("POST", d_path(world["billing"]), as_=world["max"], body=new(**dates))
    assert resp.status == 400 and resp.code == "invalid_dates"


@pytest.mark.parametrize("body", [
    new(depends_on="x"), new(depends_on=[1]), new(name=""), new(status="done"), new(due_date=None),
])
def test_bad_create_bodies(api, world, body):
    assert api("POST", d_path(world["billing"]), as_=world["max"], body=body).status == 400


def test_update_fields_and_completed_at(api, chain):
    resp = put(api, chain, chain["spec"], {"status": "done", "name": "Spec v2"})
    assert resp.status == 200 and resp.json["completed_at"] is not None and resp.json["name"] == "Spec v2"
    resp = put(api, chain, chain["spec"], {"status": "in_progress"})
    assert resp.status == 200 and resp.json["completed_at"] is None


def test_update_validation(api, chain):
    assert put(api, chain, chain["spec"], {}).status == 400
    assert put(api, chain, chain["spec"], {"status": "blocked"}).status == 400
    assert put(api, chain, chain["spec"], {"depends_on": []}).status == 400
    resp = put(api, chain, chain["spec"], {"due_date": "2026-10-01"})
    assert resp.status == 400 and resp.code == "invalid_dates"


def test_update_permissions(api, chain):
    assert put(api, chain, chain["spec"], {"name": "X"}, who="e1").status == 403
    assert put(api, chain, chain["spec"], {"name": "X"}, who="mia").status == 404


# =====================================================================
# Start rule
# =====================================================================
@pytest.mark.parametrize("status", ["in_progress", "done"])
def test_cannot_start_before_dependencies_are_done(api, chain, status):
    resp = put(api, chain, chain["build"], {"status": status})
    assert resp.status == 409 and resp.code == "dependencies_not_done"
    assert resp.json["error"]["details"] == {"pending": [str(chain["spec"]["id"])]}


def test_can_start_once_dependencies_are_done(api, chain):
    assert put(api, chain, chain["spec"], {"status": "done"}).status == 200
    resp = put(api, chain, chain["build"], {"status": "in_progress"})
    assert resp.status == 200 and resp.json["blocked"] is False


def test_done_cannot_be_reopened_once_a_dependent_started(api, chain):
    put(api, chain, chain["spec"], {"status": "done"})
    put(api, chain, chain["build"], {"status": "in_progress"})
    resp = put(api, chain, chain["spec"], {"status": "in_progress"})
    assert resp.status == 409 and resp.code == "dependents_started"
    # Reopening is fine while dependents have not started.
    put(api, chain, chain["build"], {"status": "not_started"})
    assert put(api, chain, chain["spec"], {"status": "in_progress"}).status == 200


def test_a_started_deliverable_cannot_gain_an_unfinished_dependency(api, world, factory):
    started = factory.deliverable(world["billing"], "Started", status="in_progress")
    open_one = factory.deliverable(world["billing"], "Open")
    done_one = factory.deliverable(world["billing"], "Done", status="done")
    resp = put(api, world, started, {"depends_on": [str(open_one["id"])]}, suffix="/dependencies")
    assert resp.status == 409 and resp.code == "dependencies_not_done"
    assert resp.json["error"]["details"] == {"pending": [str(open_one["id"])]}
    resp = put(api, world, started, {"depends_on": [str(done_one["id"])]}, suffix="/dependencies")
    assert resp.status == 200


# =====================================================================
# Dependencies and cycles
# =====================================================================
def test_replace_dependencies(api, chain):
    resp = put(api, chain, chain["launch"], {"depends_on": [str(chain["spec"]["id"]), str(chain["build"]["id"])]},
               suffix="/dependencies")
    assert resp.status == 200
    assert resp.json["depends_on"] == sorted([str(chain["spec"]["id"]), str(chain["build"]["id"])])
    resp = put(api, chain, chain["launch"], {"depends_on": []}, suffix="/dependencies")
    assert resp.status == 200 and resp.json["depends_on"] == []


def test_a_two_step_cycle_is_refused(api, chain):
    resp = put(api, chain, chain["spec"], {"depends_on": [str(chain["build"]["id"])]}, suffix="/dependencies")
    assert resp.status == 409 and resp.code == "dependency_cycle"
    assert resp.json["error"]["details"] == {"cycle": [str(chain["spec"]["id"]), str(chain["build"]["id"])]}


def test_a_longer_cycle_is_refused_and_named(api, chain, migrated_db):
    resp = put(api, chain, chain["spec"], {"depends_on": [str(chain["launch"]["id"])]}, suffix="/dependencies")
    assert resp.status == 409 and resp.code == "dependency_cycle"
    ids = [str(chain[k]["id"]) for k in ("spec", "launch", "build")]
    assert resp.json["error"]["details"]["cycle"] == ids
    # Nothing was written.
    rows = migrated_db.query("SELECT 1 FROM deliverable_dependencies WHERE deliverable_id = %s",
                             (str(chain["spec"]["id"]),))
    assert rows == []


@pytest.mark.parametrize("which", ["self", "other_project", "archived", "unknown", "malformed"])
def test_invalid_dependencies(api, chain, factory, which):
    ids = {
        "self": str(chain["spec"]["id"]),
        "other_project": str(factory.deliverable(chain["lake"])["id"]),
        "archived": str(factory.deliverable(chain["billing"], archived=True)["id"]),
        "unknown": str(uuid.uuid4()),
        "malformed": "nope",
    }
    resp = put(api, chain, chain["spec"], {"depends_on": [ids[which]]}, suffix="/dependencies")
    assert resp.status == 400 and resp.code == "invalid_dependency"


def test_at_most_50_dependencies(api, world, factory):
    target = factory.deliverable(world["billing"], "Target")
    many = [str(factory.deliverable(world["billing"])["id"]) for _ in range(51)]
    resp = put(api, world, target, {"depends_on": many}, suffix="/dependencies")
    assert resp.status == 400 and resp.code == "invalid_dependency"
    assert put(api, world, target, {"depends_on": many[:50]}, suffix="/dependencies").status == 200
    resp = put(api, world, target, {"depends_on": [str(uuid.uuid4())] * 101}, suffix="/dependencies")
    assert resp.status == 400


# =====================================================================
# Archive
# =====================================================================
def test_archive_rules(api, chain):
    resp = api("POST", d_path(chain["billing"], chain["spec"], "/archive"), as_=chain["max"])
    assert resp.status == 409 and resp.code == "has_dependents"
    resp = api("POST", d_path(chain["billing"], chain["launch"], "/archive"), as_=chain["max"])
    assert resp.status == 200 and resp.json["archived_at"] is not None
    again = api("POST", d_path(chain["billing"], chain["launch"], "/archive"), as_=chain["max"])
    assert again.status == 409 and again.code == "already_archived"
    resp = put(api, chain, chain["launch"], {"name": "X"})
    assert resp.status == 409 and resp.code == "archived"
    # With its only dependent archived, build can now be archived too.
    assert api("POST", d_path(chain["billing"], chain["build"], "/archive"), as_=chain["max"]).status == 200


def test_archive_permissions(api, chain):
    assert api("POST", d_path(chain["billing"], chain["launch"], "/archive"), as_=chain["e1"]).status == 403
    assert api("POST", d_path(chain["billing"], uuid.uuid4(), "/archive"), as_=chain["max"]).status == 404


def test_changes_on_an_archived_project_are_409(api, world, factory):
    old = factory.project(world["platform"], "Old", archived=True)
    resp = api("POST", d_path(old), as_=world["max"], body=new(start_date="2026-11-02"))
    assert resp.status == 409 and resp.code == "archived"
