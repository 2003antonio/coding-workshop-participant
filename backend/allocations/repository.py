"""Database access for the allocations service.

Parameterised SQL only. The allocation rows carry the employee's salary so
services can show admins the hourly rate; services.py drops it for everyone
else. Other projects' names are never selected for the 40-hour check.
"""

import datetime
from typing import Optional

from common import db

_ALLOCATION_SELECT = (
    "SELECT a.id, a.employee_id, e.name AS employee_name, e.salary, a.project_id, "
    "  p.name AS project_name, p.team_id, t.lead_id AS manager_id, a.hours_per_week, "
    "  a.start_date, a.end_date, a.archived_at "
    "FROM allocations a JOIN employees e ON e.id = a.employee_id "
    "  JOIN projects p ON p.id = a.project_id JOIN teams t ON t.id = p.team_id "
)


def list_allocations(include_archived: bool, project_id: Optional[str], employee_id: Optional[str],
                     date_from: Optional[datetime.date], date_to: Optional[datetime.date],
                     lead_id: Optional[str] = None) -> list:
    """Allocations matching the filters, ordered by start date then person.

    date_from/date_to keep allocations that overlap that range. lead_id keeps
    only allocations on projects of teams that person leads.
    """
    return db.query(
        _ALLOCATION_SELECT
        + "WHERE (%s OR a.archived_at IS NULL) "
          "AND (CAST(%s AS uuid) IS NULL OR a.project_id = %s) "
          "AND (CAST(%s AS uuid) IS NULL OR a.employee_id = %s) "
          "AND (CAST(%s AS date) IS NULL OR a.end_date >= %s) "
          "AND (CAST(%s AS date) IS NULL OR a.start_date <= %s) "
          "AND (CAST(%s AS uuid) IS NULL OR t.lead_id = %s) "
          "ORDER BY a.start_date, lower(e.name), a.id",
        (include_archived, project_id, project_id, employee_id, employee_id,
         date_from, date_from, date_to, date_to, lead_id, lead_id),
    )


def find_allocation(allocation_id: str) -> Optional[dict]:
    return db.query_one(_ALLOCATION_SELECT + "WHERE a.id = %s", (allocation_id,))


def lock_allocation(allocation_id: str) -> Optional[dict]:
    return db.query_one(_ALLOCATION_SELECT + "WHERE a.id = %s FOR UPDATE OF a", (allocation_id,))


def lock_project(project_id: str) -> Optional[dict]:
    """Share-lock a project (its dates and status cannot change meanwhile).

    Returns {id, team_id, manager_id, status, start_date, end_date, archived_at} or None.
    """
    return db.query_one(
        "SELECT p.id, p.team_id, t.lead_id AS manager_id, p.status, p.start_date, p.end_date, "
        "  p.archived_at "
        "FROM projects p JOIN teams t ON t.id = p.team_id WHERE p.id = %s FOR SHARE OF p",
        (project_id,),
    )


def lock_employee(employee_id: str) -> Optional[dict]:
    """Lock an employee row; returns {id, team_id, archived_at} or None.

    Every allocation write for that person takes this lock first, so two
    concurrent requests cannot both pass the 40-hour check.
    """
    return db.query_one(
        "SELECT id, team_id, archived_at FROM employees WHERE id = %s FOR UPDATE", (employee_id,))


def other_allocations(employee_id: str, start: datetime.date, end: datetime.date,
                      except_id: Optional[str]) -> list:
    """The employee's active allocations overlapping start..end, except one.

    Returns project_id, hours_per_week, start_date and end_date only.
    """
    return db.query(
        "SELECT project_id, hours_per_week, start_date, end_date FROM allocations "
        "WHERE employee_id = %s AND archived_at IS NULL "
        "  AND start_date <= %s AND end_date >= %s "
        "  AND (CAST(%s AS uuid) IS NULL OR id <> %s)",
        (employee_id, end, start, except_id, except_id),
    )


def insert_allocation(employee_id: str, project_id: str, hours_per_week: int,
                      start_date: datetime.date, end_date: datetime.date, created_by: str) -> str:
    row = db.query_one(
        "INSERT INTO allocations (employee_id, project_id, hours_per_week, start_date, end_date, "
        "created_by) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
        (employee_id, project_id, hours_per_week, start_date, end_date, created_by),
    )
    return str(row["id"])


def update_allocation(allocation_id: str, hours_per_week: int, start_date: datetime.date,
                      end_date: datetime.date) -> None:
    db.execute(
        "UPDATE allocations SET hours_per_week = %s, start_date = %s, end_date = %s WHERE id = %s",
        (hours_per_week, start_date, end_date, allocation_id),
    )


def archive_allocation(allocation_id: str) -> None:
    db.execute("UPDATE allocations SET archived_at = now() WHERE id = %s", (allocation_id,))
