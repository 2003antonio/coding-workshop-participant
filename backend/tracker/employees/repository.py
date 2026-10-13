"""Employee data access. The only place employee SQL lives. Parameterized only."""

from common import db


def get_by_id(employee_id):
    return db.query_one(
        "SELECT id, email, name, role, password_hash, failed_attempts, "
        "locked_until, created_at, archived_at "
        "FROM employees WHERE id = %s",
        (employee_id,),
    )


def get_auth_by_email(email):
    """Row needed for login, matched case-insensitively. May be archived."""
    return db.query_one(
        "SELECT id, email, role, password_hash, archived_at, "
        "failed_attempts, locked_until "
        "FROM employees WHERE lower(email) = lower(%s)",
        (email,),
    )


def increment_failed(employee_id):
    """Atomically bump the failed counter and lock for 15 min at 5 failures.

    Done in one UPDATE (no read-then-write); returns the new values.
    """
    return db.query_one(
        "UPDATE employees SET "
        "  failed_attempts = failed_attempts + 1, "
        "  locked_until = CASE WHEN failed_attempts + 1 >= 5 "
        "                 THEN now() + interval '15 minutes' "
        "                 ELSE locked_until END "
        "WHERE id = %s "
        "RETURNING failed_attempts, locked_until",
        (employee_id,),
    )


def reset_failed(employee_id):
    db.execute(
        "UPDATE employees SET failed_attempts = 0, locked_until = NULL WHERE id = %s",
        (employee_id,),
    )
