"""Integration tests for common/demo_bulk.py: the large demo keeps every rule the API enforces."""

import collections
import datetime
import random

import pytest
from service_loader import load_service

from common import auth, db, demo_bulk, demo_seed, weeks

pytestmark = pytest.mark.integration

REPORTS = load_service("reports")
_PASSWORDS = {"admin": "Bulk-Admin-Pass-1", "manager": "Bulk-Manager-Pass-2",
              "employee": "Bulk-Employee-Pass-3"}


@pytest.fixture
def bulk(migrated_db, today):
    """The small demo, then the large one on top, as the seed scripts do."""
    demo_seed.seed(_PASSWORDS)
    return demo_bulk.seed(_PASSWORDS)


def _n(sql, params=()):
    return db.query_one(sql, params)["n"]


def test_counts_and_shape(bulk):
    assert bulk["employees"] == 500 and bulk["teams"] == 30 and bulk["projects"] == 210
    assert _n("SELECT count(*) AS n FROM employees") == 511
    roles = db.query("SELECT role, count(*) AS n FROM employees WHERE email LIKE %s GROUP BY role",
                     ("%.%@" + demo_seed.DOMAIN,))
    assert {r["role"]: r["n"] for r in roles} == {"admin": 2, "manager": 30, "employee": 468}
    sizes = db.query("SELECT count(e.id) AS n FROM teams t JOIN employees e ON e.team_id = t.id "
                     "WHERE t.name NOT IN ('Platform', 'Data') GROUP BY t.id")
    assert len(sizes) == 30 and all(10 <= s["n"] <= 20 for s in sizes)
    per_team = db.query("SELECT count(*) AS n FROM projects p JOIN teams t ON t.id = p.team_id "
                        "WHERE t.name NOT IN ('Platform', 'Data') GROUP BY t.id")
    assert {r["n"] for r in per_team} == {7}
    per_project = db.query("SELECT count(d.id) AS n FROM projects p JOIN teams t ON t.id = p.team_id "
                           "LEFT JOIN deliverables d ON d.project_id = p.id "
                           "WHERE t.name NOT IN ('Platform', 'Data') GROUP BY p.id")
    assert len(per_project) == 210 and {r["n"] for r in per_project} <= {4, 5, 6}
    statuses = {r["status"] for r in db.query("SELECT DISTINCT status FROM projects")}
    assert statuses == {"planned", "active", "on_hold", "completed"}
    assert _n("SELECT count(*) AS n FROM employees WHERE salary <= 0") == 0


def test_team_rules(bulk):
    # A lead is a manager or admin, and never a member of a team they lead.
    assert _n("SELECT count(*) AS n FROM teams t JOIN employees e ON e.id = t.lead_id "
              "WHERE e.role NOT IN ('manager', 'admin') OR e.team_id = t.id") == 0
    # Allocations only for members of the project's team, one per person and project.
    assert _n("SELECT count(*) AS n FROM allocations a JOIN projects p ON p.id = a.project_id "
              "JOIN employees e ON e.id = a.employee_id WHERE e.team_id IS DISTINCT FROM p.team_id") == 0
    assert _n("SELECT count(*) AS n FROM (SELECT 1 FROM allocations GROUP BY employee_id, project_id "
              "HAVING count(*) > 1) x") == 0


def test_dates_sit_inside_their_project(bulk):
    assert _n("SELECT count(*) AS n FROM deliverables d JOIN projects p ON p.id = d.project_id "
              "WHERE d.start_date < p.start_date OR d.due_date > p.end_date "
              "OR d.start_date > d.due_date") == 0
    assert _n("SELECT count(*) AS n FROM allocations a JOIN projects p ON p.id = a.project_id "
              "WHERE a.start_date < p.start_date OR a.end_date > p.end_date") == 0
    today = weeks.today()
    assert _n("SELECT count(*) AS n FROM projects WHERE status = 'completed' AND end_date >= %s",
              (today,)) == 0
    assert _n("SELECT count(*) AS n FROM projects WHERE status = 'planned' AND start_date <= %s",
              (today,)) == 0


def test_dependency_rules(bulk):
    # Same project only, and nothing started before its dependencies are done.
    assert _n("SELECT count(*) AS n FROM deliverable_dependencies dd "
              "JOIN deliverables d ON d.id = dd.deliverable_id "
              "JOIN deliverables dep ON dep.id = dd.depends_on_id "
              "WHERE d.project_id <> dep.project_id "
              "OR (d.status <> 'not_started' AND dep.status <> 'done')") == 0
    assert _n("SELECT count(*) AS n FROM deliverables d JOIN projects p ON p.id = d.project_id "
              "WHERE p.status = 'completed' AND d.status <> 'done'") == 0
    # No cycles: a deliverable never depends (directly or not) on itself.
    assert _n("WITH RECURSIVE reach(start_id, id) AS ("
              "  SELECT deliverable_id, depends_on_id FROM deliverable_dependencies"
              "  UNION SELECT r.start_id, dd.depends_on_id FROM reach r"
              "  JOIN deliverable_dependencies dd ON dd.deliverable_id = r.id) "
              "SELECT count(*) AS n FROM reach WHERE start_id = id") == 0
    # The demo has something to show: overdue and blocked work.
    assert _n("SELECT count(*) AS n FROM deliverables WHERE due_date < %s AND status <> 'done'",
              (weeks.today(),)) > 0
    assert _n("SELECT count(*) AS n FROM deliverable_dependencies dd "
              "JOIN deliverables dep ON dep.id = dd.depends_on_id WHERE dep.status <> 'done'") > 0


def test_nobody_passes_40_hours_in_any_week(bulk):
    # Every week each allocation touches counts in full (the API's week rule).
    assert _n("SELECT count(*) AS n FROM ("
              "  SELECT a.employee_id, w.week FROM allocations a"
              "  CROSS JOIN LATERAL generate_series(date_trunc('week', a.start_date),"
              "    date_trunc('week', a.end_date), interval '1 week') AS w(week)"
              "  WHERE a.archived_at IS NULL"
              "  GROUP BY 1, 2 HAVING sum(a.hours_per_week) > 40) x") == 0


def test_the_capacity_report_agrees(bulk, call_service):
    admin = db.query_one("SELECT id, role FROM employees WHERE email = %s", (demo_seed.email("admin"),))
    api = call_service(REPORTS)
    bounds = db.query_one("SELECT min(start_date) AS lo, max(end_date) AS hi FROM allocations")
    start, near = weeks.week_start(bounds["lo"]), 0
    while start <= bounds["hi"]:  # the report takes at most 52 weeks at a time
        end = start + datetime.timedelta(weeks=52, days=-1)
        query = f"from={start}&to={end}&threshold="
        over = api("GET", "/api/reports/over-allocated", as_=admin, query=query + "40")
        assert over.status == 200 and over.json["people"] == []
        near += len(api("GET", "/api/reports/over-allocated", as_=admin, query=query + "35").json["people"])
        start = end + datetime.timedelta(days=1)
    assert near > 0


def test_people_sign_in_with_their_roles_password(bulk):
    for role in demo_seed.ROLES:
        row = db.query_one("SELECT password_hash FROM employees WHERE role = %s AND email LIKE %s "
                           "LIMIT 1", (role, "%.%@" + demo_seed.DOMAIN))
        assert auth.verify_password(_PASSWORDS[role], row["password_hash"])


def test_is_seeded_marks_the_large_demo_only(migrated_db, today):
    demo_seed.seed(_PASSWORDS)
    assert demo_seed.is_seeded() and not demo_bulk.is_seeded()
    demo_bulk.seed(_PASSWORDS)
    assert demo_bulk.is_seeded()


def test_the_same_seed_builds_the_same_organisation():
    monday = weeks.week_start(weeks.today())
    first = demo_bulk.build(random.Random(demo_bulk.SEED), monday, weeks.today())
    second = demo_bulk.build(random.Random(demo_bulk.SEED), monday, weeks.today())
    assert [e[1:] for e in first["employees"] if e[6] is None] == \
           [e[1:] for e in second["employees"] if e[6] is None]
    assert [p[2:] for p in first["projects"]] == [p[2:] for p in second["projects"]]


def test_reset_removes_the_large_demo_too(bulk):
    assert demo_seed.reset() is None
    assert _n("SELECT count(*) AS n FROM employees") == 0
    assert not demo_bulk.is_seeded()


def test_at_risk_projects_are_a_minority_with_every_kind_of_reason(bulk, call_service):
    admin = db.query_one("SELECT id, role FROM employees WHERE email = %s", (demo_seed.email("admin"),))
    resp = call_service(REPORTS)("GET", "/api/reports/at-risk-projects", as_=admin)
    flagged = resp.json["projects"]
    reasons = collections.Counter(reason for p in flagged for reason in p["reasons"])
    assert 0.1 <= len(flagged) / 213 <= 0.4, (len(flagged), reasons)
    assert set(reasons) >= {"overdue_deliverable", "blocked_past_start", "dependency_date_conflict",
                       "over_budget"}
