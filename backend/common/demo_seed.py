"""The demo organisation: its data and the database writes that create it.

Creates 1 admin, 2 managers and 8 employees (with salaries), 2 teams with a
lead and 3+ members each, 3 projects, deliverables with dependencies, and
allocations that respect the 40-hour rule. One employee (hal) has no team and
no allocations, so the employee empty states can be shown. Dates are relative
to the current week, so the demo always has work in progress, something
overdue, something blocked and someone near capacity.

Two callers: scripts/seed_demo.py (local database) and the auth Lambda's
direct-invoke action (cloud database, which only the Lambdas can reach).
Passwords are passed in by the caller and are never printed or logged.
"""

import datetime
from typing import Optional

from common import audit, auth, db, weeks

DOMAIN = "acme-demo.test"
ROLES = ("admin", "manager", "employee")
MIN_PASSWORD = 12
# Every table reset() empties; the audit log is kept (its rows have no foreign keys).
RESET_TABLES = ("allocations", "deliverable_dependencies", "deliverables", "projects",
                "refresh_tokens", "teams", "employees")

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
    ("ana", "mobile", 6, 14, 40),      # 36 h in those weeks: near capacity; Mobile has
                                       # 1 person, so its costs are hidden from its manager
    ("bo", "billing", 20, -14, 60),
    ("cy", "billing", 20, -7, 45),
    ("di", "billing", 15, 31, 50),
    ("eli", "lake", 25, -7, 60),
    ("fay", "lake", 25, -7, 60),
    ("gus", "lake", 20, 0, 85),
]

# A believable recent history for the Activity screen, written through the
# normal audit module: (days ago, hour, actor, action, entity type, entity key,
# details). Details hold only labels and field names, never an amount.
HISTORY = [
    (21, 9, "admin", "employee_created", "employee", "marta", None),
    (21, 9, "admin", "employee_created", "employee", "ken", None),
    (21, 10, "admin", "employee_created", "employee", "ana", None),
    (21, 10, "admin", "employee_created", "employee", "bo", None),
    (21, 10, "admin", "employee_created", "employee", "cy", None),
    (21, 11, "admin", "employee_created", "employee", "di", None),
    (21, 11, "admin", "employee_created", "employee", "eli", None),
    (21, 11, "admin", "employee_created", "employee", "fay", None),
    (21, 12, "admin", "employee_created", "employee", "gus", None),
    (21, 12, "admin", "employee_created", "employee", "hal", None),
    (20, 9, "admin", "team_created", "team", "platform", None),
    (20, 9, "admin", "team_created", "team", "data", None),
    (20, 10, "admin", "team_member_added", "team", "platform", {"employee_id": "ana"}),
    (20, 10, "admin", "team_member_added", "team", "platform", {"employee_id": "bo"}),
    (20, 10, "admin", "team_member_added", "team", "platform", {"employee_id": "cy"}),
    (20, 10, "admin", "team_member_added", "team", "platform", {"employee_id": "di"}),
    (20, 11, "admin", "team_member_added", "team", "data", {"employee_id": "eli"}),
    (20, 11, "admin", "team_member_added", "team", "data", {"employee_id": "fay"}),
    (20, 11, "admin", "team_member_added", "team", "data", {"employee_id": "gus"}),
    (16, 14, "marta", "project_created", "project", "billing", None),
    (16, 15, "ken", "project_created", "project", "lake", None),
    (15, 9, "marta", "deliverable_created", "deliverable", "spec", None),
    (15, 9, "marta", "deliverable_created", "deliverable", "docs", None),
    (15, 9, "marta", "deliverable_created", "deliverable", "legacy", None),
    (15, 10, "marta", "deliverable_created", "deliverable", "build", None),
    (15, 10, "marta", "deliverable_created", "deliverable", "qa", None),
    (15, 10, "marta", "deliverable_created", "deliverable", "launch", None),
    (15, 13, "admin", "allocation_created", "allocation", ("ana", "billing"), None),
    (15, 13, "admin", "allocation_created", "allocation", ("bo", "billing"), None),
    (14, 11, "ken", "deliverable_created", "deliverable", "ingest", None),
    (14, 11, "ken", "deliverable_created", "deliverable", "model", None),
    (14, 11, "ken", "deliverable_created", "deliverable", "dash", None),
    (14, 14, "admin", "allocation_created", "allocation", ("eli", "lake"), None),
    (14, 14, "admin", "allocation_created", "allocation", ("fay", "lake"), None),
    (10, 16, "admin", "employee_salary_changed", "employee", "bo", None),
    (8, 10, "admin", "allocation_created", "allocation", ("cy", "billing"), None),
    (7, 9, "marta", "project_created", "project", "mobile", None),
    (7, 10, "marta", "deliverable_created", "deliverable", "design", None),
    (7, 11, "admin", "allocation_created", "allocation", ("ana", "mobile"), None),
    (6, 15, "admin", "allocation_created", "allocation", ("gus", "lake"), None),
    (4, 10, "marta", "deliverable_updated", "deliverable", "spec", {"fields": ["status"]}),
    (3, 9, "marta", "deliverable_updated", "deliverable", "build", {"fields": ["status"]}),
    (3, 14, "marta", "project_updated", "project", "billing", {"fields": ["planned_budget"]}),
    (2, 11, "marta", "deliverable_archived", "deliverable", "legacy", None),
    (2, 15, "ken", "allocation_updated", "allocation", ("gus", "lake"), {"fields": ["hours_per_week"]}),
    (2, 16, "admin", "allocation_created", "allocation", ("di", "billing"), None),
    (1, 9, "ana", "login_success", "employee", "ana", None),
    (1, 9, "marta", "login_success", "employee", "marta", None),
    (0, 8, "admin", "login_success", "employee", "admin", None),
]


def email(key: str) -> str:
    return f"{key}@{DOMAIN}"


def accounts() -> list:
    """(role, email) for every demo person, in PEOPLE order."""
    return [(role, email(key)) for key, _, role, _, _ in PEOPLE]


def valid_passwords(passwords: object) -> bool:
    """True if `passwords` maps each role to a string of at least MIN_PASSWORD characters."""
    return (isinstance(passwords, dict)
            and all(isinstance(passwords.get(role), str) and len(passwords[role]) >= MIN_PASSWORD
                    for role in ROLES))


def is_seeded() -> bool:
    """True once the demo admin exists (seeding is all-or-nothing)."""
    return db.query_one("SELECT 1 AS hit FROM employees WHERE lower(email) = %s",
                        (email("admin"),)) is not None


def reset() -> Optional[str]:
    """Empty the demo tables. Returns why it refused, or None once done."""
    others = db.query_one("SELECT count(*) AS n FROM employees WHERE lower(email) NOT LIKE %s",
                          ("%@" + DOMAIN,))["n"]
    if others:
        return f"the database has {others} account(s) outside @{DOMAIN}"
    with db.transaction():
        db.execute("TRUNCATE " + ", ".join(RESET_TABLES))
        audit.record("demo_reset", None, None, None, {"tables": len(RESET_TABLES)})
    return None


def _history(ids: dict, now: datetime.datetime) -> None:
    """Record HISTORY in time order, back-dated from `now` (each row a minute apart within its hour)."""
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    for minute, (days_ago, hour, actor, action, entity_type, entity, details) in enumerate(HISTORY):
        at = midnight - datetime.timedelta(days=days_ago) + datetime.timedelta(hours=hour, minutes=minute % 60)
        if at >= now:
            at = now - datetime.timedelta(minutes=len(HISTORY) - minute)
        if details and "employee_id" in details:
            details = {"employee_id": str(ids[details["employee_id"]])}
        audit.record(action, ids[actor], entity_type, ids[entity], details, at=at)


def seed(passwords: dict, monday: Optional[datetime.date] = None) -> dict:
    """Insert everything in one transaction; returns how many rows of each kind.

    `passwords` maps each role to its password. `monday` defaults to this week's.
    """
    monday = monday or weeks.week_start(weeks.today())

    def day(offset: int) -> datetime.date:
        return monday + datetime.timedelta(days=offset)

    hashes = {role: auth.hash_password(passwords[role]) for role in ROLES}
    ids = {}
    with db.transaction():
        for key, name, role, title, salary in PEOPLE:
            ids[key] = db.query_one(
                "INSERT INTO employees (email, name, role, password_hash, job_title, salary) "
                "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                (email(key), name, role, hashes[role], title, salary))["id"]
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
            ids[(person, project)] = db.query_one(
                "INSERT INTO allocations (employee_id, project_id, hours_per_week, start_date, "
                "end_date, created_by) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                (ids[person], ids[project], hours, day(start), day(end), ids["admin"]))["id"]
        # One deliverable that was dropped: archived (never deleted), so the history can say so.
        ids["legacy"] = db.query_one(
            "INSERT INTO deliverables (project_id, name, status, start_date, due_date, archived_at) "
            "VALUES (%s, 'Legacy CSV export', 'not_started', %s, %s, now()) RETURNING id",
            (ids["billing"], day(-14), day(-7)))["id"]
        _history(ids, datetime.datetime.now(datetime.timezone.utc))
        counts = {"employees": len(PEOPLE), "teams": len(TEAMS), "projects": len(PROJECTS),
                  "deliverables": len(DELIVERABLES), "allocations": len(ALLOCATIONS)}
        audit.record("demo_seeded", None, None, None, counts)
    return counts
