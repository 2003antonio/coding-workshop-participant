"""POST/PUT/archive allocations: who may allocate whom, dates, closed projects,
overlaps, and the 40-hour rule (contract section 6)."""

import threading
import time
import uuid

import pg8000.dbapi
import pytest

pytestmark = pytest.mark.integration

LIST = "/api/allocations/"


def one(alloc, suffix=""):
    return f"{LIST}{alloc['id'] if isinstance(alloc, dict) else alloc}{suffix}"


# =====================================================================
# Permissions per role
# =====================================================================
def test_manager_allocates_a_member_of_their_team_on_its_project(new, api, world):
    resp = api("POST", LIST, as_=world["max"], body=new(world))
    assert resp.status == 201
    assert resp.json["employee"]["name"] == "Eli Two" and "hourly_rate" not in resp.json


def test_admin_allocates_anyone_anywhere_and_sees_the_rate(new, api, world):
    resp = api("POST", LIST, as_=world["admin"], body=new(world, employee="d1", project="billing"))
    assert resp.status == 201 and resp.json["hourly_rate"] == 45.0
    resp = api("POST", LIST, as_=world["admin"], body=new(world, employee="max", project="billing"))
    assert resp.status == 201


@pytest.mark.parametrize("employee, project, status", [
    ("d1", "billing", 403),     # not on the manager's team
    ("max", "billing", 403),    # the lead is never a member, so cannot allocate themselves
    ("e2", "lake", 404),        # a project the manager cannot see
    ("d1", "lake", 404),
])
def test_manager_outside_their_own_team_is_refused(new, api, world, migrated_db, employee, project, status):
    resp = api("POST", LIST, as_=world["max"], body=new(world, employee=employee, project=project))
    assert resp.status == status
    assert migrated_db.query_one("SELECT count(*) AS n FROM allocations")["n"] == 1


def test_employees_cannot_allocate(new, api, world):
    assert api("POST", LIST, as_=world["e1"], body=new(world)).status == 403


def test_a_removed_member_can_no_longer_be_allocated_by_the_manager(new, api, world, migrated_db):
    migrated_db.execute("UPDATE employees SET team_id = NULL WHERE id = %s", (str(world["e2"]["id"]),))
    assert api("POST", LIST, as_=world["max"], body=new(world)).status == 403


# =====================================================================
# Input
# =====================================================================
@pytest.mark.parametrize("hours", [0, 41, 20.5, "20", True, None])
def test_hours_are_whole_numbers_from_1_to_40(new, api, world, hours):
    resp = api("POST", LIST, as_=world["admin"], body=new(world, hours_per_week=hours))
    assert resp.status == 400 and resp.code == "bad_request"


@pytest.mark.parametrize("dates", [
    {"start_date": "2026-11-20", "end_date": "2026-11-19"},
    {"start_date": "2026-10-26"},
    {"end_date": "2027-04-01"},
])
def test_dates_must_fit_the_project(new, api, world, dates):
    resp = api("POST", LIST, as_=world["admin"], body=new(world, **dates))
    assert resp.status == 400 and resp.code == "invalid_dates"


def test_invalid_employee(new, api, world, factory):
    gone = factory.employee(archived=True, team=world["platform"])
    for employee_id in (str(gone["id"]), str(uuid.uuid4()), "nope"):
        body = dict(new(world), employee_id=employee_id)
        resp = api("POST", LIST, as_=world["admin"], body=body)
        assert resp.status == 400 and resp.code == "invalid_employee"


def test_bad_bodies(new, api, world):
    for body in ([], dict(new(world), notes="x"), dict(new(world), project_id="x")):
        assert api("POST", LIST, as_=world["admin"], body=body).status == 400
    assert api("POST", LIST, as_=world["admin"], body=dict(new(world), project_id=str(uuid.uuid4()))).status == 404


@pytest.mark.parametrize("kind", ["completed", "archived"])
def test_closed_projects_take_no_allocations(new, api, world, factory, kind):
    closed = factory.project(world["platform"], status="completed" if kind == "completed" else "active",
                             archived=kind == "archived")
    resp = api("POST", LIST, as_=world["max"], body=dict(new(world), project_id=str(closed["id"])))
    assert resp.status == 409 and resp.code == "project_closed"


def test_overlapping_allocation_on_the_same_project_is_409(new, api, world):
    resp = api("POST", LIST, as_=world["admin"],
               body=new(world, employee="e1", hours_per_week=5, start_date="2026-12-18", end_date="2026-12-31"))
    assert resp.status == 409 and resp.code == "overlapping_allocation"
    resp = api("POST", LIST, as_=world["admin"],
               body=new(world, employee="e1", hours_per_week=5, start_date="2026-12-21", end_date="2026-12-31"))
    assert resp.status == 201


# =====================================================================
# 40-hour rule
# =====================================================================
def test_over_40_hours_is_409_with_the_weeks(new, api, world):
    # e1 has 20 h on Billing from 2026-11-02 to 2026-12-18; 21 more on Search
    # for two weeks crosses 40 in both.
    resp = api("POST", LIST, as_=world["max"],
               body=new(world, employee="e1", project="search", hours_per_week=21,
                        start_date="2026-12-14", end_date="2026-12-22"))
    assert resp.status == 409 and resp.code == "over_allocated"
    assert resp.json["error"]["details"] == {"weeks": [{"week_start": "2026-12-14", "hours": 41}]}


def test_exactly_40_hours_is_allowed(new, api, world):
    resp = api("POST", LIST, as_=world["max"],
               body=new(world, employee="e1", project="search", hours_per_week=20))
    assert resp.status == 201


def test_a_partial_week_counts_in_full(new, api, world):
    # Saturday 2026-12-19 is in the week of 2026-12-14, when Billing still has 20 h.
    resp = api("POST", LIST, as_=world["max"],
               body=new(world, employee="e1", project="search", hours_per_week=30,
                        start_date="2026-12-19", end_date="2026-12-31"))
    assert resp.status == 409
    assert resp.json["error"]["details"]["weeks"] == [{"week_start": "2026-12-14", "hours": 50}]


def test_hours_on_projects_the_manager_cannot_see_still_count_but_are_not_named(new, api, world, factory):
    factory.allocation(world["e2"], world["lake"], hours=30, start="2026-11-02", end="2026-11-06")
    resp = api("POST", LIST, as_=world["max"], body=new(world, hours_per_week=20))
    assert resp.status == 409 and resp.code == "over_allocated"
    assert resp.json["error"]["details"]["weeks"] == [{"week_start": "2026-11-02", "hours": 50}]
    assert "Lake" not in resp.text and str(world["lake"]["id"]) not in resp.text


def test_archived_allocations_do_not_count(new, api, world, factory):
    factory.allocation(world["e2"], world["search"], hours=40, archived=True)
    assert api("POST", LIST, as_=world["max"], body=new(world, hours_per_week=40)).status == 201


def test_two_concurrent_requests_cannot_both_pass(new, api, world, migrated_db, test_database):
    # Hold e2's row lock from another connection so both requests are queued
    # behind it at the same moment, then let them go: only one may succeed.
    blocker = pg8000.dbapi.connect(host=test_database["host"], port=test_database["port"],
                                   database="acme_test", user=test_database["user"],
                                   password=test_database["password"] or None)
    cur = blocker.cursor()
    cur.execute("SELECT id FROM employees WHERE id = %s FOR UPDATE", (str(world["e2"]["id"]),))
    results = []

    def attempt(project):
        from common import db
        try:
            results.append(api("POST", LIST, as_=world["admin"],
                               body=new(world, project=project, hours_per_week=30)).status)
        finally:
            db.close()

    threads = [threading.Thread(target=attempt, args=(p,)) for p in ("billing", "search")]
    for t in threads:
        t.start()
    deadline = time.time() + 10
    while time.time() < deadline:
        waiting = migrated_db.query_one(
            "SELECT count(*) AS n FROM pg_stat_activity WHERE datname = 'acme_test' "
            "AND wait_event_type = 'Lock'")["n"]
        if waiting >= 2:
            break
        time.sleep(0.05)
    blocker.rollback()
    for t in threads:
        t.join(timeout=30)
    blocker.close()
    assert sorted(results) == [201, 409]


# =====================================================================
# Update
# =====================================================================
def test_update_rechecks_without_counting_itself(api, world, factory):
    # Alone, e1's 20 h can become 40.
    resp = api("PUT", one(world["a1"]), as_=world["max"], body={"hours_per_week": 40})
    assert resp.status == 200 and resp.json["hours_per_week"] == 40
    factory.allocation(world["e1"], world["search"], hours=10, start="2026-12-14", end="2026-12-18")
    resp = api("PUT", one(world["a1"]), as_=world["max"], body={"hours_per_week": 35})
    assert resp.status == 409 and resp.code == "over_allocated"
    resp = api("PUT", one(world["a1"]), as_=world["max"], body={"end_date": "2026-12-11"})
    assert resp.status == 200


def test_update_validation_and_permissions(api, world):
    assert api("PUT", one(world["a1"]), as_=world["max"], body={}).status == 400
    assert api("PUT", one(world["a1"]), as_=world["max"], body={"employee_id": "x"}).status == 400
    resp = api("PUT", one(world["a1"]), as_=world["max"], body={"end_date": "2027-05-01"})
    assert resp.status == 400 and resp.code == "invalid_dates"
    assert api("PUT", one(world["a1"]), as_=world["mia"], body={"hours_per_week": 5}).status == 404
    assert api("PUT", one(world["a1"]), as_=world["e1"], body={"hours_per_week": 5}).status == 403


def test_update_on_a_completed_project_is_409(api, world, migrated_db):
    migrated_db.execute("UPDATE projects SET status = 'completed' WHERE id = %s", (str(world["billing"]["id"]),))
    resp = api("PUT", one(world["a1"]), as_=world["max"], body={"hours_per_week": 5})
    assert resp.status == 409 and resp.code == "project_closed"


# =====================================================================
# Archive
# =====================================================================
def test_archive(api, world):
    resp = api("POST", one(world["a1"], "/archive"), as_=world["max"])
    assert resp.status == 200 and resp.json["archived_at"] is not None
    again = api("POST", one(world["a1"], "/archive"), as_=world["max"])
    assert again.status == 409 and again.code == "already_archived"
    resp = api("PUT", one(world["a1"]), as_=world["admin"], body={"hours_per_week": 5})
    assert resp.status == 409 and resp.code == "archived"


def test_after_removal_from_the_team_only_admin_can_archive(api, world, migrated_db):
    migrated_db.execute("UPDATE employees SET team_id = NULL WHERE id = %s", (str(world["e1"]["id"]),))
    assert api("POST", one(world["a1"], "/archive"), as_=world["max"]).status == 403
    assert api("POST", one(world["a1"], "/archive"), as_=world["admin"]).status == 200


def test_archive_permissions(api, world):
    assert api("POST", one(world["a1"], "/archive"), as_=world["e1"]).status == 403
    assert api("POST", one(world["a1"], "/archive"), as_=world["mia"]).status == 404
    assert api("POST", one(uuid.uuid4(), "/archive"), as_=world["admin"]).status == 404


def test_writes_are_audited_without_hours_or_rates(new, api, world, migrated_db):
    api("POST", LIST, as_=world["max"], body=new(world))
    api("PUT", one(world["a1"]), as_=world["max"], body={"hours_per_week": 10})
    rows = migrated_db.query("SELECT action, details FROM audit_log ORDER BY created_at")
    assert [(r["action"], r["details"]) for r in rows] == [
        ("allocation_created", None), ("allocation_updated", {"fields": ["hours_per_week"]})]
