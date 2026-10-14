"""Seed a small demo organisation into the LOCAL database. LOCAL USE ONLY.

Creates 1 admin, 2 managers and 8 employees (with salaries), 2 teams with a
lead and 3+ members each (one employee stays on no team), 3 projects,
deliverables with dependencies, and allocations that respect the 40-hour
rule. Dates are relative to the current week, so the demo always has work in
progress, something overdue, something blocked and someone near capacity.

Passwords come from environment variables (or .env.local), one per role, and
are never printed or logged:
    DEMO_ADMIN_PASSWORD, DEMO_MANAGER_PASSWORD, DEMO_EMPLOYEE_PASSWORD
Each must be at least 12 characters.

Refuses any database host other than localhost. Idempotent: if the demo admin
already exists, nothing is changed.

Usage (repo root):
    .venv/Scripts/python.exe scripts/seed_demo.py      (Windows)
    .venv/bin/python scripts/seed_demo.py              (Linux / macOS)
"""

import datetime
import os
import sys
from typing import Optional

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "..", "backend"))
sys.path.insert(0, _HERE)

from local_env import load_local_env  # noqa: E402
from common import audit, auth, db, weeks  # noqa: E402
from common.migrations.runner import run_migrations  # noqa: E402

_LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
_MIN_PASSWORD = 12
PASSWORD_VARS = {"admin": "DEMO_ADMIN_PASSWORD", "manager": "DEMO_MANAGER_PASSWORD",
                 "employee": "DEMO_EMPLOYEE_PASSWORD"}
DOMAIN = "acme-demo.test"

# (key, name, role, job title, annual salary)
PEOPLE = [
    ("admin", "Alex Admin", "admin", "Head of Operations", 180000),
    ("marta", "Marta Lopez", "manager", "Engineering Manager", 150000),
    ("ken", "Ken Ito", "manager", "Data Manager", 145000),
    ("ana", "Ana Silva", "employee", "Senior Engineer", 124800),
    ("bo", "Bo Chen", "employee", "Engineer", 104000),
    ("cy", "Cy Okafor", "employee", "Engineer", 99840),
    ("di", "Di Novak", "employee", "QA Engineer", 93600),
    ("eli", "Eli Haddad", "employee", "Data Engineer", 114400),
    ("fay", "Fay Morgan", "employee", "Data Analyst", 87360),
    ("gus", "Gus Petrov", "employee", "Data Engineer", 108160),
    ("hal", "Hal Reyes", "employee", "Designer", 83200),
]

# (key, name, lead, members)
TEAMS = [
    ("platform", "Platform", "marta", ["ana", "bo", "cy", "di"]),
    ("data", "Data", "ken", ["eli", "fay", "gus"]),
]

# (key, team, name, status, start offset days, end offset days, planned budget);
# offsets are from this week's Monday. Billing's budget sits below its
# committed cost, so the demo shows an over-budget project.
PROJECTS = [
    ("billing", "platform", "Billing v2", "active", -14, 120, 38000),
    ("mobile", "platform", "Mobile app", "planned", 14, 150, 12000),
    ("lake", "data", "Data lake", "active", -7, 90, 50000),
]

# (key, project, name, status, start offset, due offset, depends on)
DELIVERABLES = [
    ("spec", "billing", "API spec", "done", -14, -3, []),
    ("docs", "billing", "Migration guide", "not_started", -14, -1, []),
    ("build", "billing", "Build billing API", "in_progress", -2, 30, ["spec"]),
    ("qa", "billing", "QA sign-off", "not_started", 31, 50, ["build"]),
    ("launch", "billing", "Launch", "not_started", 51, 60, ["qa", "docs"]),
    ("design", "mobile", "App design", "not_started", 14, 40, []),
    ("ingest", "lake", "Ingest pipeline", "in_progress", -7, 20, []),
    ("model", "lake", "Data model", "not_started", 10, 60, ["ingest"]),
    ("dash", "lake", "Dashboards", "not_started", 61, 85, ["model"]),
]

# (person, project, hours per week, start offset, end offset)
ALLOCATIONS = [
    ("ana", "billing", 30, -14, 60),
    ("ana", "mobile", 6, 14, 40),      # 36 h in those weeks: near capacity
    ("bo", "billing", 20, -14, 60),
    ("cy", "billing", 20, -7, 45),
    ("di", "billing", 15, 31, 50),
    ("hal", "mobile", 10, 14, 70),     # Mobile has 2 people: hidden from its manager
    ("eli", "lake", 25, -7, 60),
    ("fay", "lake", 25, -7, 60),
    ("gus", "lake", 20, 0, 85),
]


def _passwords() -> Optional[dict]:
    """The three role passwords from the environment, or None if any is missing or short."""
    values = {role: os.getenv(var, "") for role, var in PASSWORD_VARS.items()}
    if any(len(value) < _MIN_PASSWORD for value in values.values()):
        return None
    return values


def _email(key: str) -> str:
    return f"{key}@{DOMAIN}"


def _seed(passwords: dict, monday: datetime.date) -> dict:
    """Insert everything in one transaction; returns how many rows of each kind."""
    def day(offset: int) -> datetime.date:
        return monday + datetime.timedelta(days=offset)

    hashes = {role: auth.hash_password(pw) for role, pw in passwords.items()}
    ids = {}
    with db.transaction():
        for key, name, role, title, salary in PEOPLE:
            ids[key] = db.query_one(
                "INSERT INTO employees (email, name, role, password_hash, job_title, salary) "
                "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                (_email(key), name, role, hashes[role], title, salary))["id"]
        for key, name, lead, members in TEAMS:
            ids[key] = db.query_one("INSERT INTO teams (name, lead_id) VALUES (%s, %s) RETURNING id",
                                    (name, ids[lead]))["id"]
            for member in members:
                db.execute("UPDATE employees SET team_id = %s WHERE id = %s", (ids[key], ids[member]))
        for key, team, name, status, start, end, planned_budget in PROJECTS:
            ids[key] = db.query_one(
                "INSERT INTO projects (team_id, name, status, start_date, end_date, planned_budget) "
                "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                (ids[team], name, status, day(start), day(end), planned_budget))["id"]
        for key, project, name, status, start, due, depends_on in DELIVERABLES:
            ids[key] = db.query_one(
                "INSERT INTO deliverables (project_id, name, status, start_date, due_date, completed_at) "
                "VALUES (%s, %s, %s, %s, %s, CASE WHEN %s THEN now() END) RETURNING id",
                (ids[project], name, status, day(start), day(due), status == "done"))["id"]
            for dependency in depends_on:
                db.execute("INSERT INTO deliverable_dependencies (deliverable_id, depends_on_id) "
                           "VALUES (%s, %s)", (ids[key], ids[dependency]))
        for person, project, hours, start, end in ALLOCATIONS:
            db.execute(
                "INSERT INTO allocations (employee_id, project_id, hours_per_week, start_date, "
                "end_date, created_by) VALUES (%s, %s, %s, %s, %s, %s)",
                (ids[person], ids[project], hours, day(start), day(end), ids["admin"]))
        counts = {"employees": len(PEOPLE), "teams": len(TEAMS), "projects": len(PROJECTS),
                  "deliverables": len(DELIVERABLES), "allocations": len(ALLOCATIONS)}
        audit.record("demo_seeded", None, None, None, counts)
    return counts


def main(argv: Optional[list] = None) -> int:
    """Seed the demo. Returns a process exit code (0 ok or already seeded, 2 refused)."""
    load_local_env()
    if os.getenv("POSTGRES_HOST", "localhost") not in _LOCAL_HOSTS:
        print("Refusing to seed: POSTGRES_HOST is not a local database.", file=sys.stderr)
        return 2
    passwords = _passwords()
    if passwords is None:
        print("Not seeded: set " + ", ".join(PASSWORD_VARS.values())
              + f" (each at least {_MIN_PASSWORD} characters).", file=sys.stderr)
        return 2

    run_migrations()
    if db.query_one("SELECT 1 AS hit FROM employees WHERE lower(email) = %s", (_email("admin"),)):
        print("Demo data already present; nothing changed.")
        return 0

    counts = _seed(passwords, weeks.week_start(weeks.today()))
    print("Seeded demo: " + ", ".join(f"{n} {kind}" for kind, n in counts.items()) + ".")
    print("Log in as (password from the matching DEMO_*_PASSWORD variable):")
    for key, _, role, _, _ in PEOPLE:
        print(f"  {role:<9} {_email(key)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
