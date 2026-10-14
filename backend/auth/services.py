"""Authentication business rules: login, refresh rotation, logout, current user.

Refresh tokens are random opaque strings, never JWTs; only their SHA-256 hash
is stored, and each one works exactly once.
"""

import datetime

import repository
from common import audit, auth, db
from common.errors import Unauthorized

REFRESH_TTL = datetime.timedelta(days=7)

# One generic answer for every bad-credential case (unknown email, wrong
# password, locked, archived) so none can be told apart.
_INVALID_CREDENTIALS = ("Invalid email or password.", "invalid_credentials")
_INVALID_REFRESH = ("Invalid refresh token.", "invalid_token")


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _issue_refresh_token(employee_id: object) -> tuple:
    """Create and store a new refresh token; returns (raw_token, row_id)."""
    raw = auth.generate_refresh_token()
    token_id = repository.insert_refresh_token(
        employee_id, auth.hash_refresh_token(raw), _now() + REFRESH_TTL
    )
    return raw, token_id


def login(email: str, password: str) -> dict:
    """Check credentials; exactly one scrypt runs on every path.

    Returns:
        {access_token, refresh_token, user: {id, email, name, role}}.

    Raises:
        Unauthorized: invalid_credentials for every kind of failure.
    """
    row = repository.find_employee_by_email(email)

    if row is None:
        auth.dummy_verify()
        audit.record("login_failure", None, details={"reason": "unknown_email"})
        raise Unauthorized(*_INVALID_CREDENTIALS)

    audit.set_actor(row["id"])

    if row["archived_at"] is not None:
        auth.dummy_verify()
        audit.record("login_failure", row["id"], "employee", row["id"], {"reason": "archived"})
        raise Unauthorized(*_INVALID_CREDENTIALS)

    if row["locked_until"] is not None and row["locked_until"] > _now():
        auth.dummy_verify()
        audit.record("login_locked", row["id"], "employee", row["id"])
        raise Unauthorized(*_INVALID_CREDENTIALS)

    if not auth.verify_password(password, row["password_hash"]):
        result = repository.record_failed_attempt(row["id"])
        audit.record("login_failure", row["id"], "employee", row["id"],
                     {"reason": "wrong_password", "failed_attempts": result["failed_attempts"]})
        raise Unauthorized(*_INVALID_CREDENTIALS)

    with db.transaction():
        repository.reset_failed_attempts(row["id"])
        refresh_raw, _ = _issue_refresh_token(row["id"])
        audit.record("login_success", row["id"], "employee", row["id"])
    return {
        # Role comes from the database row just read.
        "access_token": auth.make_access_token(row["id"], row["role"]),
        "refresh_token": refresh_raw,
        "user": {"id": str(row["id"]), "email": row["email"],
                 "name": row["name"], "role": row["role"]},
    }


def refresh(presented: str) -> dict:
    """Rotate a refresh token: single use, inside one transaction.

    A token that was already used (or revoked) is treated as stolen: every
    active token of that employee is revoked. Rejections are raised only after
    the transaction commits, so those revocations are kept.

    Returns:
        {access_token, refresh_token}.

    Raises:
        Unauthorized: invalid_token for every kind of failure.
    """
    result = None
    with db.transaction():
        row = repository.find_refresh_token(auth.hash_refresh_token(presented))
        if row is None:
            pass
        elif row["revoked_at"] is not None:
            audit.set_actor(row["employee_id"])
            revoked = repository.revoke_all_refresh_tokens(row["employee_id"])
            audit.record("refresh_reuse_detected", row["employee_id"], "employee",
                         row["employee_id"], {"revoked_tokens": revoked})
        elif row["expires_at"] <= _now():
            pass  # Expired: reject. Not revoked, so a retry is not mistaken for reuse.
        else:
            employee = repository.find_employee_by_id(row["employee_id"])
            if employee is not None and employee["archived_at"] is None:
                audit.set_actor(employee["id"])
                new_raw, new_id = _issue_refresh_token(employee["id"])
                repository.revoke_refresh_token(row["id"], replaced_by=new_id)
                audit.record("refresh", employee["id"], "employee", employee["id"])
                result = {
                    "access_token": auth.make_access_token(employee["id"], employee["role"]),
                    "refresh_token": new_raw,
                }
    if result is None:
        raise Unauthorized(*_INVALID_REFRESH)
    return result


def logout(presented: str) -> None:
    """Revoke the presented refresh token. Unknown tokens are ignored (no leak)."""
    with db.transaction():
        row = repository.find_refresh_token(auth.hash_refresh_token(presented))
        if row is not None and row["revoked_at"] is None:
            audit.set_actor(row["employee_id"])
            repository.revoke_refresh_token(row["id"])
            audit.record("logout", row["employee_id"], "employee", row["employee_id"])


def me(employee: dict) -> dict:
    """Public view of the authenticated employee: never hash, salary or lock fields."""
    return {
        "id": str(employee["id"]),
        "email": employee["email"],
        "name": employee["name"],
        "role": employee["role"],
        "job_title": employee["job_title"],
    }
