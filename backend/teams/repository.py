"""Database access for the teams service.

Parameterised SQL only. Salaries are read in exactly one place,
member_salaries(), for the team budget; no other query here selects them.
"""

from typing import Optional

import pg8000.dbapi

from common import db

# A team with its lead's name and its count of active members.
_TEAM_SELECT = (
    "SELECT t.id, t.name, t.lead_id, l.name AS lead_name, t.archived_at, "
    "  (SELECT count(*) FROM employees m "
    "   WHERE m.team_id = t.id AND m.archived_at IS NULL) AS member_count "
    "FROM teams t JOIN employees l ON l.id = t.lead_id "
)

_UNIQUE_VIOLATION = "23505"


def list_teams(include_archived: bool, lead_id: Optional[str] = None,
               team_id: Optional[str] = None) -> list:
    """Teams ordered by name, optionally only those led by lead_id or only team_id."""
    return db.query(
        _TEAM_SELECT
        + "WHERE (%s OR t.archived_at IS NULL) "
          "AND (CAST(%s AS uuid) IS NULL OR t.lead_id = %s) "
          "AND (CAST(%s AS uuid) IS NULL OR t.id = %s) "
          "ORDER BY lower(t.name), t.id",
        (include_archived, lead_id, lead_id, team_id, team_id),
    )


def find_team(team_id: str) -> Optional[dict]:
    """One team (archived or not), or None."""
    return db.query_one(_TEAM_SELECT + "WHERE t.id = %s", (team_id,))


def lock_team(team_id: str) -> Optional[dict]:
    """Lock a team row until the transaction ends; returns {id, lead_id, archived_at} or None.

    Every change to a team's lead or members takes this lock first, so the
    "a lead is never a member" rule cannot be raced.
    """
    return db.query_one(
        "SELECT id, lead_id, archived_at FROM teams WHERE id = %s FOR UPDATE", (team_id,))


def employee_team_id(employee_id: str) -> Optional[str]:
    """The team the employee belongs to, or None."""
    row = db.query_one("SELECT team_id FROM employees WHERE id = %s", (employee_id,))
    return str(row["team_id"]) if row and row["team_id"] else None


def lock_employee(employee_id: str) -> Optional[dict]:
    """Lock an employee row; returns {id, role, team_id, archived_at} or None.

    The employees service takes the same lock before demoting or archiving,
    so a lead cannot be named while they are being demoted.
    """
    return db.query_one(
        "SELECT id, role, team_id, archived_at FROM employees WHERE id = %s FOR UPDATE",
        (employee_id,),
    )


def members(team_id: str) -> list:
    """Active members of a team, ordered by name."""
    return db.query(
        "SELECT id, name, job_title, role FROM employees "
        "WHERE team_id = %s AND archived_at IS NULL ORDER BY lower(name), id",
        (team_id,),
    )


def member_salaries(team_id: str) -> list:
    """Annual salaries of the team's active members (for the team budget only)."""
    rows = db.query(
        "SELECT salary FROM employees WHERE team_id = %s AND archived_at IS NULL", (team_id,))
    return [row["salary"] for row in rows]


def insert_team(name: str, lead_id: str) -> Optional[str]:
    """Insert a team; returns its id, or None if an active team has that name (any case)."""
    row = db.query_one(
        "INSERT INTO teams (name, lead_id) VALUES (%s, %s) "
        "ON CONFLICT ((lower(name))) WHERE archived_at IS NULL DO NOTHING RETURNING id",
        (name, lead_id),
    )
    return str(row["id"]) if row else None


def name_taken(name: str, except_team_id: str) -> bool:
    """True if another active team already has this name (any case)."""
    row = db.query_one(
        "SELECT 1 AS hit FROM teams "
        "WHERE lower(name) = lower(%s) AND archived_at IS NULL AND id <> %s",
        (name, except_team_id),
    )
    return row is not None


def update_team(team_id: str, name: Optional[str], lead_id: Optional[str]) -> bool:
    """Update name and/or lead (None = unchanged). Returns False if the new name is taken.

    name_taken() is checked first; this catches the rare race where another
    team takes the name in between (the unique index is the final guard).
    """
    try:
        db.execute(
            "UPDATE teams SET name = COALESCE(%s, name), lead_id = COALESCE(%s, lead_id) "
            "WHERE id = %s",
            (name, lead_id, team_id),
        )
    except pg8000.dbapi.DatabaseError as exc:
        details = exc.args[0] if exc.args and isinstance(exc.args[0], dict) else {}
        if details.get("C") == _UNIQUE_VIOLATION:
            return False
        raise
    return True


def set_employee_team(employee_id: str, team_id: Optional[str]) -> None:
    """Put an employee on a team, or on none (team_id None)."""
    db.execute("UPDATE employees SET team_id = %s WHERE id = %s", (team_id, employee_id))


def has_active_projects(team_id: str) -> bool:
    row = db.query_one(
        "SELECT 1 AS hit FROM projects WHERE team_id = %s AND archived_at IS NULL LIMIT 1",
        (team_id,),
    )
    return row is not None


def archive_team(team_id: str) -> None:
    """Archive a team and take every member off it."""
    db.execute("UPDATE teams SET archived_at = now() WHERE id = %s", (team_id,))
    db.execute("UPDATE employees SET team_id = NULL WHERE team_id = %s", (team_id,))
