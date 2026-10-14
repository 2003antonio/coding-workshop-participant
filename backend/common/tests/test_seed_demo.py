"""Integration tests for scripts/seed_demo.py."""

import datetime
import os

import pytest

import seed_demo
from common import auth, db, weeks

pytestmark = pytest.mark.integration

_PASSWORDS = {"DEMO_ADMIN_PASSWORD": "Demo-Admin-Pass-1", "DEMO_MANAGER_PASSWORD": "Demo-Manager-Pass-2",
              "DEMO_EMPLOYEE_PASSWORD": "Demo-Employee-Pass-3"}


@pytest.fixture
def demo_env(migrated_db, monkeypatch):
    # Never read the real .env.local; each test controls exactly what the script sees.
    monkeypatch.setattr(seed_demo, "load_local_env", lambda *args, **kwargs: None)
    for name in [n for n in os.environ if n.startswith("DEMO_")]:
        monkeypatch.delenv(name)
    for name, value in _PASSWORDS.items():
        monkeypatch.setenv(name, value)
    return monkeypatch


def _count(table):
    return db.query_one("SELECT count(*) AS n FROM " + table)["n"]


def test_seeds_the_demo_organisation(demo_env, capsys):
    assert seed_demo.main([]) == 0
    roles = db.query("SELECT role, count(*) AS n FROM employees GROUP BY role")
    assert {r["role"]: r["n"] for r in roles} == {"admin": 1, "manager": 2, "employee": 8}
    assert db.query_one("SELECT count(*) AS n FROM employees WHERE salary <= 0")["n"] == 0
    assert (_count("teams"), _count("projects")) == (2, 3)
    assert db.query_one("SELECT count(*) AS n FROM projects WHERE planned_budget > 0")["n"] == 3
    assert _count("deliverable_dependencies") >= 3 and _count("allocations") >= 5
    out = capsys.readouterr()
    assert "admin@acme-demo.test" in out.out
    for password in _PASSWORDS.values():
        assert password not in out.out + out.err


def test_teams_have_a_lead_who_is_not_a_member_and_three_or_more_members(demo_env):
    seed_demo.main([])
    rows = db.query(
        "SELECT t.id, l.role AS lead_role, l.team_id AS lead_team, "
        "  (SELECT count(*) FROM employees m WHERE m.team_id = t.id) AS members FROM teams t "
        "JOIN employees l ON l.id = t.lead_id")
    for row in rows:
        assert row["members"] >= 3 and row["lead_role"] == "manager" and row["lead_team"] != row["id"]


def test_seeded_data_follows_the_business_rules(demo_env):
    seed_demo.main([])
    # 40-hour rule in every week.
    allocs = db.query("SELECT employee_id, hours_per_week, start_date, end_date FROM allocations")
    load = {}
    for a in allocs:
        for monday in weeks.weeks_touched(a["start_date"], a["end_date"]):
            key = (a["employee_id"], monday)
            load[key] = load.get(key, 0) + a["hours_per_week"]
    assert max(load.values()) <= 40
    assert any(h > 32 for h in load.values())       # someone is near capacity
    # Allocations and deliverables sit inside their project's dates.
    outside = db.query_one(
        "SELECT count(*) AS n FROM allocations a JOIN projects p ON p.id = a.project_id "
        "WHERE a.start_date < p.start_date OR a.end_date > p.end_date")["n"]
    outside += db.query_one(
        "SELECT count(*) AS n FROM deliverables d JOIN projects p ON p.id = d.project_id "
        "WHERE d.start_date < p.start_date OR d.due_date > p.end_date")["n"]
    assert outside == 0
    # Nothing has started before its dependencies are done.
    early = db.query_one(
        "SELECT count(*) AS n FROM deliverable_dependencies dd "
        "JOIN deliverables d ON d.id = dd.deliverable_id JOIN deliverables p ON p.id = dd.depends_on_id "
        "WHERE d.status <> 'not_started' AND p.status <> 'done'")["n"]
    assert early == 0


def test_passwords_are_hashed_per_role(demo_env):
    seed_demo.main([])
    rows = db.query("SELECT role, password_hash FROM employees")
    for row in rows:
        assert row["password_hash"].startswith("scrypt$")
        expected = _PASSWORDS[seed_demo.PASSWORD_VARS[row["role"]]]
        assert auth.verify_password(expected, row["password_hash"])


def test_running_twice_changes_nothing(demo_env, capsys):
    seed_demo.main([])
    before = _count("employees")
    assert seed_demo.main([]) == 0
    assert _count("employees") == before
    assert "already present" in capsys.readouterr().out


@pytest.mark.parametrize("host", ["db.example.com", "10.0.0.5"])
def test_refuses_a_non_local_host(demo_env, capsys, host):
    demo_env.setenv("POSTGRES_HOST", host)
    assert seed_demo.main([]) == 2
    assert "Refusing" in capsys.readouterr().err
    assert _count("employees") == 0


@pytest.mark.parametrize("missing", list(_PASSWORDS))
def test_missing_or_short_passwords_refuse_without_printing_them(demo_env, capsys, missing):
    demo_env.setenv(missing, "short")
    assert seed_demo.main([]) == 2
    out = capsys.readouterr()
    assert "short" not in out.out + out.err
    for password in _PASSWORDS.values():
        assert password not in out.out + out.err
    assert _count("employees") == 0


def test_dates_follow_the_current_week(demo_env, monkeypatch):
    monkeypatch.setattr(weeks, "today", lambda: datetime.date(2030, 6, 12))
    seed_demo.main([])
    starts = db.query_one("SELECT min(start_date) AS first FROM projects")["first"]
    assert starts == datetime.date(2030, 6, 10) - datetime.timedelta(days=14)


def test_one_demo_project_is_over_its_planned_budget(demo_env):
    from common import budget
    seed_demo.main([])
    rows = db.query(
        "SELECT p.name, p.planned_budget, a.hours_per_week, a.start_date, a.end_date, e.salary "
        "FROM projects p JOIN allocations a ON a.project_id = p.id JOIN employees e ON e.id = a.employee_id")
    committed, planned = {}, {}
    for r in rows:
        cost = budget.allocation_cost(r["hours_per_week"], r["salary"], r["start_date"], r["end_date"],
                                      weeks.today())
        committed[r["name"]] = committed.get(r["name"], 0) + cost["planned"]
        planned[r["name"]] = r["planned_budget"]
    over = sorted(name for name in committed if committed[name] > planned[name])
    assert over == ["Billing v2"]


def test_hal_has_no_team_and_no_allocations(demo_env):
    seed_demo.main([])
    hal = db.query_one("SELECT id, team_id FROM employees WHERE email = 'hal@acme-demo.test'")
    assert hal["team_id"] is None
    assert db.query_one("SELECT count(*) AS n FROM allocations WHERE employee_id = %s",
                        (hal["id"],))["n"] == 0


def test_reset_puts_the_demo_back_as_seeded(demo_env, capsys):
    seed_demo.main([])
    expected = {name: _count(name) for name in seed_demo._RESET_TABLES if name != "refresh_tokens"}
    db.execute("UPDATE projects SET archived_at = now(), name = 'renamed' WHERE name = 'Billing v2'")
    db.execute("INSERT INTO refresh_tokens (employee_id, token_hash, expires_at) "
               "SELECT id, 'x', now() + interval '1 day' FROM employees LIMIT 1")
    audit_before = _count("audit_log")
    assert seed_demo.main(["--reset"]) == 0
    assert {name: _count(name) for name in expected} == expected
    assert db.query_one("SELECT count(*) AS n FROM projects WHERE name = 'Billing v2' "
                        "AND archived_at IS NULL")["n"] == 1
    assert _count("refresh_tokens") == 0
    assert _count("audit_log") > audit_before          # the audit log is kept, not emptied
    out = capsys.readouterr()
    assert "Demo data removed." in out.out
    for password in _PASSWORDS.values():
        assert password not in out.out + out.err


def test_reset_refuses_when_other_accounts_exist(demo_env, capsys, make_employee):
    seed_demo.main([])
    make_employee(email="someone@acme.test")
    before = _count("employees")
    assert seed_demo.main(["--reset"]) == 2
    assert "Refusing to reset" in capsys.readouterr().err
    assert _count("employees") == before
