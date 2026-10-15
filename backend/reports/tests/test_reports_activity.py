"""Report 8, Activity: who did what and when, from audit_log (contract section 8).

Admin sees every row; a manager only rows about the projects of teams they
lead (and those projects' deliverables and assignments); employees are refused.
No row ever carries a salary, rate or cost figure, and the stored details
object is never returned.
"""

import json

import pytest
from service_loader import load_service

pytestmark = pytest.mark.integration

EMPLOYEES = load_service("employees")
SALARY = 131313  # an odd number that appears nowhere else in the test data


@pytest.fixture
def log(migrated_db):
    """log(action, actor, entity_type, entity, details, minute): one audit row at 2026-11-11 09:<minute>."""
    def _log(action, actor, entity_type=None, entity=None, details=None, minute=0):
        migrated_db.execute(
            "INSERT INTO audit_log (actor_id, action, entity_type, entity_id, details, created_at) "
            "VALUES (%s, %s, %s, %s, CAST(%s AS jsonb), %s)",
            (actor["id"] if actor else None, action, entity_type, entity["id"] if entity else None,
             json.dumps(details) if details is not None else None,
             f"2026-11-11T09:{minute:02d}:00+00:00"),
        )
    return _log


@pytest.fixture
def history(world, log, factory):
    """A small history across every type, oldest first (minute 0..)."""
    w = world
    alloc = factory.allocation(w["e3"], w["billing"], hours=5, start="2026-12-07", end="2026-12-11")
    lake_alloc = factory.allocation(w["d1"], w["lake"], hours=5, start="2027-01-04", end="2027-01-08")
    rows = [
        ("employee_created", w["admin"], "employee", w["e1"], None),
        ("employee_salary_changed", w["admin"], "employee", w["e2"], None),
        ("team_created", w["admin"], "team", w["platform"], None),
        ("team_member_added", w["admin"], "team", w["platform"], {"employee_id": str(w["e3"]["id"])}),
        ("project_created", w["max"], "project", w["billing"], None),
        ("project_updated", w["max"], "project", w["billing"], {"fields": ["end_date", "planned_budget"]}),
        ("deliverable_archived", w["max"], "deliverable", w["late"], None),
        ("allocation_updated", w["max"], "allocation", alloc, {"fields": ["hours_per_week"]}),
        ("project_created", w["mia"], "project", w["lake"], None),
        ("allocation_created", w["mia"], "allocation", lake_alloc, None),
        ("login_success", w["max"], "employee", w["max"], None),
        ("login_failure", None, None, None, {"reason": "unknown_email"}),
        ("refresh", w["max"], "employee", w["max"], None),
        ("something_new", w["admin"], "project", w["billing"], {"secret": "x"}),
    ]
    for minute, (action, actor, etype, entity, details) in enumerate(rows):
        log(action, actor, etype, entity, details, minute)
    return w


def get(api, who, **query):
    return api("GET", "/api/reports/activity", as_=who, query="&".join(f"{k}={v}" for k, v in query.items()))


def sentences(resp):
    return [r["sentence"] for r in resp.json["activity"]]


def test_admin_sees_every_listed_row_newest_first_in_plain_words(api, history):
    resp = get(api, history["admin"])
    assert resp.status == 200
    assert resp.json["total"] == 12  # 14 rows minus the token refresh and the unknown action
    assert sentences(resp) == [
        "A sign-in with an unknown email failed",
        "Max Manager signed in",
        "Mia Manager assigned Dan Data to project 'Lake'",
        "Mia Manager created project 'Lake'",
        "Max Manager changed the assignment of Emma Three on project 'Billing' (hours per week)",
        "Max Manager archived deliverable 'Late'",
        "Max Manager updated project 'Billing' (end date, planned budget)",
        "Max Manager created project 'Billing'",
        "Ada Admin added Emma Three to team 'Platform'",
        "Ada Admin created team 'Platform'",
        "Ada Admin changed a salary for Eli Two",
        "Ada Admin added Eve One",
    ]
    first, last = resp.json["activity"][0], resp.json["activity"][-1]
    assert first["actor"] is None and first["type"] == "sign-ins"
    assert last["actor"] == {"id": str(history["admin"]["id"]), "name": "Ada Admin", "role": "admin"}
    assert last["occurred_at"].startswith("2026-11-11T09:00:00")
    assert set(last) == {"id", "occurred_at", "actor", "action", "type", "entity_type", "entity_id", "sentence"}


def test_manager_sees_only_their_teams_projects_deliverables_and_assignments(api, history):
    resp = get(api, history["max"])
    assert resp.status == 200
    assert sentences(resp) == [
        "Max Manager changed the assignment of Emma Three on project 'Billing' (hours per week)",
        "Max Manager archived deliverable 'Late'",
        "Max Manager updated project 'Billing' (end date, planned budget)",
        "Max Manager created project 'Billing'",
    ]
    assert resp.json["total"] == 4
    assert sentences(get(api, history["mia"])) == ["Mia Manager assigned Dan Data to project 'Lake'",
                                                    "Mia Manager created project 'Lake'"]
    for kind in ("people", "teams", "sign-ins"):
        assert get(api, history["max"], type=kind).json == {"activity": [], "total": 0, "limit": 50, "offset": 0}


def test_employees_are_refused_and_a_token_is_needed(api, history):
    assert get(api, history["e1"]).status == 403
    assert api("GET", "/api/reports/activity").status == 401


def test_limit_offset_and_type_filter(api, history):
    page = get(api, history["admin"], limit=2, offset=1)
    assert page.json["total"] == 12 and page.json["limit"] == 2 and page.json["offset"] == 1
    assert sentences(page) == ["Max Manager signed in", "Mia Manager assigned Dan Data to project 'Lake'"]
    assert get(api, history["admin"], offset=12).json["activity"] == []
    teams = get(api, history["admin"], type="teams")
    assert teams.json["total"] == 2 and {r["type"] for r in teams.json["activity"]} == {"teams"}
    assert sentences(get(api, history["admin"], type="assignments"))[1] == (
        "Max Manager changed the assignment of Emma Three on project 'Billing' (hours per week)")
    for bad in ({"limit": "0"}, {"limit": "101"}, {"limit": "ten"}, {"offset": "-1"}, {"type": "salaries"}):
        assert get(api, history["admin"], **bad).status == 400


def test_names_come_from_joins_and_missing_records_have_a_fallback(api, world, log, migrated_db):
    log("deliverable_archived", world["admin"], "deliverable", {"id": "00000000-0000-0000-0000-000000000001"})
    log("team_member_removed", world["admin"], "team", world["data"], {"employee_id": "not-a-uuid"}, minute=1)
    migrated_db.execute("UPDATE projects SET name = 'Billing v3' WHERE id = %s", (world["billing"]["id"],))
    log("project_archived", world["max"], "project", world["billing"], minute=2)
    assert sentences(get(api, world["admin"])) == [
        "Max Manager archived project 'Billing v3'",
        "Ada Admin removed someone from team 'Data'",
        "Ada Admin archived a deliverable",
    ]


def test_no_salary_rate_or_cost_figure_ever_appears(api, call_service, history, migrated_db):
    """A real salary change through the employees API, plus a row whose stored details carry
    numbers; neither admin nor manager may get any of those figures back."""
    w = history
    employees = call_service(EMPLOYEES)
    changed = employees("PUT", f"/api/employees/{w['e1']['id']}", as_=w["admin"], body={"salary": SALARY})
    assert changed.status == 200
    hourly = round(SALARY / 2080, 2)  # 63.13
    with_numbers = {"fields": ["hours_per_week"], "hourly_rate": hourly, "cost": 4242.42, "salary_note": SALARY}
    migrated_db.execute(
        "INSERT INTO audit_log (actor_id, action, entity_type, entity_id, details) "
        "VALUES (%s, 'project_updated', 'project', %s, CAST(%s AS jsonb))",
        (w["max"]["id"], w["billing"]["id"], json.dumps(with_numbers)),
    )
    for who in (w["admin"], w["max"]):
        resp = get(api, who, limit=100)
        assert resp.status == 200
        for figure in (str(SALARY), "131,313", str(hourly), "4242", "104000", "124800"):
            assert figure not in resp.text, f"{figure} reached the {who['role']}"
        assert all("details" not in row for row in resp.json["activity"])
        assert "Max Manager updated project 'Billing' (hours per week)" in sentences(resp)
    assert "Ada Admin changed a salary for Eve One" in sentences(get(api, w["admin"], type="people"))


def test_rows_whose_actor_no_longer_exists_are_left_out(api, world, log):
    """Only a demo reset removes people (they are otherwise archived), so such rows are hidden."""
    log("project_created", {"id": "00000000-0000-0000-0000-0000000000aa"}, "project", world["billing"])
    log("project_archived", world["max"], "project", world["billing"], minute=1)
    assert sentences(get(api, world["admin"])) == ["Max Manager archived project 'Billing'"]


def test_unarchived_rows_are_whitelisted_sentences_with_manager_scope(api, world, log):
    log("employee_unarchived", world["admin"], "employee", world["e1"], {"salary": SALARY})
    log("project_unarchived", world["max"], "project", world["billing"], {"note": "x"}, minute=1)
    admin = get(api, world["admin"])
    assert sentences(admin) == ["Max Manager unarchived project 'Billing'", "Ada Admin unarchived Eve One"]
    assert str(SALARY) not in admin.text and all("details" not in r for r in admin.json["activity"])
    # A manager sees the project row of their team, never the people row.
    assert sentences(get(api, world["max"])) == ["Max Manager unarchived project 'Billing'"]
    assert sentences(get(api, world["mia"])) == []
