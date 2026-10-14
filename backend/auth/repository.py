"""Database access for the auth service: employees for login, refresh tokens.

Parameterised SQL only. Refresh tokens are stored as SHA-256 hashes, never raw.
"""

import datetime
from typing import Optional

from common import db


# =====================================================================
# Employees
# =====================================================================
def find_employee_by_email(email: str) -> Optional[dict]:
    """Return the login row for an email, matched case-insensitively (may be archived)."""
    return db.query_one(
        "SELECT id, email, name, role, job_title, password_hash, failed_attempts, "
        "locked_until, archived_at FROM employees WHERE lower(email) = lower(%s)",
        (email,),
    )


def find_employee_by_id(employee_id: object) -> Optional[dict]:
    """Return {id, email, name, role, job_title, archived_at} for an id, or None."""
    return db.query_one(
        "SELECT id, email, name, role, job_title, archived_at FROM employees WHERE id = %s",
        (str(employee_id),),
    )


def record_failed_attempt(employee_id: object) -> dict:
    """Count one failed login atomically, in ONE statement (no read-then-write).

    Inside SET, column names mean the values *before* this update:
    - an expired old lock: restart the count at 1 and clear the lock;
    - otherwise add 1, and lock for 15 minutes when the count reaches 5.

    Returns:
        {failed_attempts, locked_until} after the update.
    """
    return db.query_one(
        "UPDATE employees SET "
        "  failed_attempts = CASE "
        "    WHEN locked_until IS NOT NULL AND locked_until <= now() THEN 1 "
        "    ELSE failed_attempts + 1 END, "
        "  locked_until = CASE "
        "    WHEN locked_until IS NOT NULL AND locked_until <= now() THEN NULL "
        "    WHEN failed_attempts + 1 >= 5 THEN now() + interval '15 minutes' "
        "    ELSE locked_until END "
        "WHERE id = %s "
        "RETURNING failed_attempts, locked_until",
        (str(employee_id),),
    )


def reset_failed_attempts(employee_id: object) -> None:
    """Clear the failed-login counter and any lock."""
    db.execute(
        "UPDATE employees SET failed_attempts = 0, locked_until = NULL WHERE id = %s",
        (str(employee_id),),
    )


# =====================================================================
# Refresh tokens
# =====================================================================
def insert_refresh_token(employee_id: object, token_hash: str,
                         expires_at: datetime.datetime) -> object:
    """Store a refresh token's hash; returns the new row id."""
    row = db.query_one(
        "INSERT INTO refresh_tokens (employee_id, token_hash, expires_at) "
        "VALUES (%s, %s, %s) RETURNING id",
        (str(employee_id), token_hash, expires_at),
    )
    return row["id"]


def find_refresh_token(token_hash: str) -> Optional[dict]:
    """Return the token row for a hash, locking it until the transaction ends.

    FOR UPDATE makes two simultaneous refreshes with the same token take turns,
    so a token can never be rotated twice.
    """
    return db.query_one(
        "SELECT id, employee_id, expires_at, revoked_at, replaced_by "
        "FROM refresh_tokens WHERE token_hash = %s FOR UPDATE",
        (token_hash,),
    )


def revoke_refresh_token(token_id: object, replaced_by: object = None) -> None:
    """Revoke one token (if still active), optionally recording its replacement."""
    db.execute(
        "UPDATE refresh_tokens SET revoked_at = now(), replaced_by = %s "
        "WHERE id = %s AND revoked_at IS NULL",
        (str(replaced_by) if replaced_by is not None else None, str(token_id)),
    )


def revoke_all_refresh_tokens(employee_id: object) -> int:
    """Revoke every active refresh token of an employee; returns how many."""
    return db.execute(
        "UPDATE refresh_tokens SET revoked_at = now() "
        "WHERE employee_id = %s AND revoked_at IS NULL",
        (str(employee_id),),
    )
