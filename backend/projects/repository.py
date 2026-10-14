"""Database access for the projects service (projects and their deliverables).

Parameterised SQL only. Salaries are read in exactly one place,
budget_allocations(), for the project budget; no other query here selects them.

Locking: every change to a project or its deliverables first locks the
project row (lock_project). That serialises all writes inside one project,
so date checks, status rules and the dependency cycle check cannot be raced.
"""

import datetime
from decimal import Decimal
from typing import Optional

from common import db

# A project with its team's name and its manager (the team's current lead).
_PROJECT_SELECT = (
    "SELECT p.id, p.team_id, t.name AS team_name, t.lead_id AS manager_id, "
    "  l.name AS manager_name, p.name, p.description, p.status, p.start_date, "
    "  p.end_date, p.planned_budget, p.archived_at "
    "FROM projects p JOIN teams t ON t.id = p.team_id JOIN employees l ON l.id = t.lead_id "
)

_DELIVERABLE_COLUMNS = (
    "id, project_id, name, description, start_date, due_date, status, completed_at, archived_at"
)


# =====================================================================
# Projects
# =====================================================================
def _contains_pattern(text: str) -> str:
    """A LIKE pattern matching `text` anywhere, with the wildcards in it escaped.

    The escape character is a backslash (see ESCAPE in list_projects), so a
    search for "50%" matches only a literal "50%".
    """
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return "%" + escaped + "%"


def list_projects(include_archived: bool, team_id: Optional[str], status: Optional[str],
                  lead_id: Optional[str] = None, allocated_to: Optional[str] = None,
                  q: Optional[str] = None) -> list:
    """Projects ordered by start date then name.

    lead_id keeps only projects of teams that person leads; allocated_to only
    projects where that person has an active allocation. q keeps projects whose
    name or description contains it (any case). Every filter is ANDed, so a
    search never widens what the visibility filters allow.
    """
    pattern = _contains_pattern(q) if q is not None else None
    return db.query(
        _PROJECT_SELECT
        + "WHERE (%s OR p.archived_at IS NULL) "
          "AND (CAST(%s AS uuid) IS NULL OR p.team_id = %s) "
          "AND (CAST(%s AS text) IS NULL OR p.status = %s) "
          "AND (CAST(%s AS uuid) IS NULL OR t.lead_id = %s) "
          "AND (CAST(%s AS uuid) IS NULL OR EXISTS (SELECT 1 FROM allocations a "
          "     WHERE a.project_id = p.id AND a.employee_id = %s AND a.archived_at IS NULL)) "
          "AND (CAST(%s AS text) IS NULL "
          "     OR p.name ILIKE %s ESCAPE '\\' OR p.description ILIKE %s ESCAPE '\\') "
          "ORDER BY p.start_date, lower(p.name), p.id",
        (include_archived, team_id, team_id, status, status, lead_id, lead_id,
         allocated_to, allocated_to, pattern, pattern, pattern),
    )


def find_project(project_id: str) -> Optional[dict]:
    """One project (archived or not), or None."""
    return db.query_one(_PROJECT_SELECT + "WHERE p.id = %s", (project_id,))


def lock_project(project_id: str) -> Optional[dict]:
    """Lock the project row until the transaction ends; returns the joined row or None."""
    return db.query_one(_PROJECT_SELECT + "WHERE p.id = %s FOR UPDATE OF p", (project_id,))


def has_active_allocation(project_id: str, employee_id: str) -> bool:
    row = db.query_one(
        "SELECT 1 AS hit FROM allocations "
        "WHERE project_id = %s AND employee_id = %s AND archived_at IS NULL LIMIT 1",
        (project_id, employee_id),
    )
    return row is not None


def lock_team(team_id: str) -> Optional[dict]:
    """Share-lock a team so it cannot be archived or change lead meanwhile.

    Returns {id, lead_id, archived_at} or None.
    """
    return db.query_one(
        "SELECT id, lead_id, archived_at FROM teams WHERE id = %s FOR SHARE", (team_id,))


def insert_project(team_id: str, name: str, description: str, status: str,
                   start_date: datetime.date, end_date: datetime.date,
                   planned_budget: Optional[Decimal]) -> str:
    row = db.query_one(
        "INSERT INTO projects (team_id, name, description, status, start_date, end_date, "
        "planned_budget) VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
        (team_id, name, description, status, start_date, end_date, planned_budget),
    )
    return str(row["id"])


def update_project(project_id: str, changes: dict) -> None:
    """Set the given columns; keys must be among the editable ones.

    planned_budget may be set to None (cleared), so it is applied only when
    the key is present rather than through COALESCE.
    """
    db.execute(
        "UPDATE projects SET "
        "  team_id = COALESCE(%s, team_id), name = COALESCE(%s, name), "
        "  description = COALESCE(%s, description), status = COALESCE(%s, status), "
        "  start_date = COALESCE(%s, start_date), end_date = COALESCE(%s, end_date), "
        "  planned_budget = CASE WHEN %s THEN CAST(%s AS numeric) ELSE planned_budget END "
        "WHERE id = %s",
        (changes.get("team_id"), changes.get("name"), changes.get("description"),
         changes.get("status"), changes.get("start_date"), changes.get("end_date"),
         "planned_budget" in changes, changes.get("planned_budget"), project_id),
    )


def has_work_outside(project_id: str, start: datetime.date, end: datetime.date) -> bool:
    """True if an active deliverable or allocation falls outside start..end."""
    row = db.query_one(
        "SELECT EXISTS (SELECT 1 FROM deliverables WHERE project_id = %s AND archived_at IS NULL "
        "               AND (start_date < %s OR due_date > %s)) "
        "    OR EXISTS (SELECT 1 FROM allocations WHERE project_id = %s AND archived_at IS NULL "
        "               AND (start_date < %s OR end_date > %s)) AS hit",
        (project_id, start, end, project_id, start, end),
    )
    return row["hit"]


def has_open_deliverables(project_id: str) -> bool:
    row = db.query_one(
        "SELECT 1 AS hit FROM deliverables "
        "WHERE project_id = %s AND archived_at IS NULL AND status <> 'done' LIMIT 1",
        (project_id,),
    )
    return row is not None


def archive_project(project_id: str) -> None:
    """Archive a project together with its deliverables and allocations."""
    db.execute("UPDATE deliverables SET archived_at = now() "
               "WHERE project_id = %s AND archived_at IS NULL", (project_id,))
    db.execute("UPDATE allocations SET archived_at = now() "
               "WHERE project_id = %s AND archived_at IS NULL", (project_id,))
    db.execute("UPDATE projects SET archived_at = now() WHERE id = %s", (project_id,))


def budget_allocations(project_id: str) -> list:
    """Active allocations of a project with each person's name and salary (budget only)."""
    return db.query(
        "SELECT a.id, a.employee_id, e.name AS employee_name, a.hours_per_week, "
        "  a.start_date, a.end_date, e.salary "
        "FROM allocations a JOIN employees e ON e.id = a.employee_id "
        "WHERE a.project_id = %s AND a.archived_at IS NULL "
        "ORDER BY lower(e.name), a.start_date, a.id",
        (project_id,),
    )


# =====================================================================
# Deliverables
# =====================================================================
def list_deliverables(project_id: str) -> list:
    """Every deliverable of a project (archived too), ordered by due date then name."""
    return db.query(
        "SELECT " + _DELIVERABLE_COLUMNS + " FROM deliverables WHERE project_id = %s "
        "ORDER BY due_date, lower(name), id",
        (project_id,),
    )


def dependency_edges(project_id: str) -> list:
    """Every (deliverable_id, depends_on_id) pair inside a project."""
    return db.query(
        "SELECT dd.deliverable_id, dd.depends_on_id FROM deliverable_dependencies dd "
        "JOIN deliverables d ON d.id = dd.deliverable_id WHERE d.project_id = %s",
        (project_id,),
    )


def insert_deliverable(project_id: str, name: str, description: str,
                       start_date: datetime.date, due_date: datetime.date) -> str:
    row = db.query_one(
        "INSERT INTO deliverables (project_id, name, description, start_date, due_date) "
        "VALUES (%s, %s, %s, %s, %s) RETURNING id",
        (project_id, name, description, start_date, due_date),
    )
    return str(row["id"])


def update_deliverable(deliverable_id: str, changes: dict) -> None:
    """Set the given fields. A status change also sets or clears completed_at."""
    status = changes.get("status")
    db.execute(
        "UPDATE deliverables SET "
        "  name = COALESCE(%s, name), description = COALESCE(%s, description), "
        "  start_date = COALESCE(%s, start_date), due_date = COALESCE(%s, due_date), "
        "  status = COALESCE(%s, status), "
        "  completed_at = CASE WHEN CAST(%s AS text) IS NULL THEN completed_at "
        "                      WHEN %s = 'done' THEN now() ELSE NULL END "
        "WHERE id = %s",
        (changes.get("name"), changes.get("description"), changes.get("start_date"),
         changes.get("due_date"), status, status, status, deliverable_id),
    )


def replace_dependencies(deliverable_id: str, depends_on: list) -> None:
    db.execute("DELETE FROM deliverable_dependencies WHERE deliverable_id = %s", (deliverable_id,))
    for depends_on_id in depends_on:
        db.execute(
            "INSERT INTO deliverable_dependencies (deliverable_id, depends_on_id) VALUES (%s, %s)",
            (deliverable_id, depends_on_id),
        )


def archive_deliverable(deliverable_id: str) -> None:
    db.execute("UPDATE deliverables SET archived_at = now() WHERE id = %s", (deliverable_id,))
