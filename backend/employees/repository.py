"""Database access for the employees service.

Parameterised SQL only. Every statement names its columns: password_hash,
failed_attempts and locked_until are never read here, so they cannot leak.
"""

from decimal import Decimal
from typing import Optional

from common import db


def list_employees(include_archived: bool) -> list:
    """Return employees ordered by name; archived ones only when asked."""
    return db.query(
        "SELECT id, email, name, role, job_title, salary, team_id, archived_at "
        "FROM employees WHERE (%s OR archived_at IS NULL) ORDER BY lower(name), id",
        (include_archived,),
    )


def find_employee(employee_id: str) -> Optional[dict]:
    """Return one employee (archived or not), or None."""
    return db.query_one(
        "SELECT id, email, name, role, job_title, salary, team_id, archived_at "
        "FROM employees WHERE id = %s",
        (employee_id,),
    )


def find_employee_for_update(employee_id: str) -> Optional[dict]:
    """Like find_employee, but locks the row until the transaction ends."""
    return db.query_one(
        "SELECT id, email, name, role, job_title, salary, team_id, archived_at "
        "FROM employees WHERE id = %s FOR UPDATE",
        (employee_id,),
    )


def lock_active_admin_ids() -> set:
    """Lock every active admin row and return their ids (as strings).

    Two admins changing each other at the same moment then take turns, so the
    "keep at least one active admin" check cannot be raced.
    """
    rows = db.query(
        "SELECT id FROM employees WHERE role = 'admin' AND archived_at IS NULL "
        "ORDER BY id FOR UPDATE"
    )
    return {str(row["id"]) for row in rows}


def insert_employee(email: str, name: str, role: str, job_title: str,
                    salary: Decimal, password_hash: str) -> Optional[dict]:
    """Insert a new employee; returns the row, or None if the email is taken (any case)."""
    return db.query_one(
        "INSERT INTO employees (email, name, role, job_title, salary, password_hash) "
        "VALUES (%s, %s, %s, %s, %s, %s) "
        "ON CONFLICT ((lower(email))) DO NOTHING "
        "RETURNING id, email, name, role, job_title, salary, team_id, archived_at",
        (email, name, role, job_title, salary, password_hash),
    )


def update_employee(employee_id: str, name: Optional[str] = None,
                    job_title: Optional[str] = None, role: Optional[str] = None,
                    salary: Optional[Decimal] = None) -> Optional[dict]:
    """Update the given fields; None means "leave unchanged". Returns the row."""
    return db.query_one(
        "UPDATE employees SET "
        "  name = COALESCE(%s, name), "
        "  job_title = COALESCE(%s, job_title), "
        "  role = COALESCE(%s, role), "
        "  salary = COALESCE(%s, salary) "
        "WHERE id = %s "
        "RETURNING id, email, name, role, job_title, salary, team_id, archived_at",
        (name, job_title, role, salary, employee_id),
    )


def archive_employee(employee_id: str) -> Optional[dict]:
    """Mark an employee archived (never deleted). Returns the row, or None if already archived."""
    return db.query_one(
        "UPDATE employees SET archived_at = now() "
        "WHERE id = %s AND archived_at IS NULL "
        "RETURNING id, email, name, role, job_title, salary, team_id, archived_at",
        (employee_id,),
    )


def leads_active_team(employee_id: str) -> bool:
    """True if the employee is the lead of at least one active team."""
    row = db.query_one(
        "SELECT 1 AS hit FROM teams WHERE lead_id = %s AND archived_at IS NULL LIMIT 1",
        (employee_id,),
    )
    return row is not None
