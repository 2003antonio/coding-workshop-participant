"""Authentication business rules: login, refresh rotation, logout, and the
per-request access-token check.

Refresh tokens are random opaque strings (secrets.token_urlsafe), never JWTs.
Only their SHA-256 hash is stored. Each refresh token works once.
"""

import datetime
import hashlib
import secrets

from auth import repository as tokens
from common import audit
from common import auth as auth_core
from common.errors import Unauthorized
from employees import repository as employees

# One generic message for every bad-credential case (unknown email, wrong
# password, locked, archived) so none can be told apart.
_INVALID = ("Invalid email or password.", "invalid_credentials")


def _now():
    return datetime.datetime.now(datetime.timezone.utc)


def _hash_token(raw):
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _issue_refresh(employee_id):
    raw = secrets.token_urlsafe(32)
    token_id = tokens.create(employee_id, _hash_token(raw), _now() + auth_core.REFRESH_TTL)
    return raw, token_id


def _bearer_token(headers):
    value = headers.get("authorization", "")
    if not value.lower().startswith("bearer "):
        raise Unauthorized("Missing bearer token.", code="unauthorized")
    return value[7:].strip()


# =====================================================================
def login(email, password):
    row = employees.get_auth_by_email(email)

    # Unknown email: spend a dummy hash so timing matches a real verify.
    if row is None:
        auth_core.dummy_verify()
        audit.record("login_failure", actor_id=None)
        raise Unauthorized(*_INVALID)

    audit.set_actor(row["id"])

    # Archived or currently locked: same generic error, same dummy-hash cost.
    if row["archived_at"] is not None:
        auth_core.dummy_verify()
        audit.record("login_failure", actor_id=row["id"])
        raise Unauthorized(*_INVALID)

    if row["locked_until"] is not None and row["locked_until"] > _now():
        auth_core.dummy_verify()
        audit.record("login_locked", actor_id=row["id"])
        raise Unauthorized(*_INVALID)

    if not auth_core.verify_password(password, row["password_hash"]):
        employees.increment_failed(row["id"])
        audit.record("login_failure", actor_id=row["id"])
        raise Unauthorized(*_INVALID)

    # Success.
    employees.reset_failed(row["id"])
    access = auth_core.make_access_token(row["id"], row["role"])
    refresh_raw, _ = _issue_refresh(row["id"])
    audit.record("login_success", actor_id=row["id"])
    return {
        "access_token": access,
        "refresh_token": refresh_raw,
        "user": {"id": row["id"], "role": row["role"]},
    }


def refresh(presented_raw):
    row = tokens.get_by_hash(_hash_token(presented_raw))
    if row is None:
        raise Unauthorized("Invalid refresh token.", code="invalid_token")

    # Already used (or revoked) token presented again -> reuse: kill the chain.
    if row["revoked_at"] is not None:
        tokens.revoke_all_active(row["employee_id"])
        audit.set_actor(row["employee_id"])
        audit.record("refresh_reuse_detected", actor_id=row["employee_id"])
        raise Unauthorized("Invalid refresh token.", code="invalid_token")

    if row["expires_at"] <= _now():
        tokens.revoke(row["id"])
        raise Unauthorized("Refresh token expired.", code="invalid_token")

    emp = employees.get_by_id(row["employee_id"])
    if emp is None or emp["archived_at"] is not None:
        raise Unauthorized("Invalid refresh token.", code="invalid_token")

    audit.set_actor(emp["id"])
    # Rotate: issue a new token, mark the old one replaced.
    new_raw, new_id = _issue_refresh(emp["id"])
    tokens.mark_replaced(row["id"], new_id)
    access = auth_core.make_access_token(emp["id"], emp["role"])
    audit.record("refresh", actor_id=emp["id"])
    return {"access_token": access, "refresh_token": new_raw}


def logout(presented_raw):
    row = tokens.get_by_hash(_hash_token(presented_raw))
    if row is not None and row["revoked_at"] is None:
        tokens.revoke(row["id"])
        audit.set_actor(row["employee_id"])
        audit.record("logout", actor_id=row["employee_id"])
    # Idempotent: no content either way, so nothing is leaked.


def authenticate(headers):
    """Verify the access token, then load the employee from the DB.

    Rejects if the token is bad, or the account is missing or archived. The
    returned row carries the role FROM THE DATABASE, which callers use for RBAC.
    """
    token = _bearer_token(headers)
    claims = auth_core.decode_token(token, expected_type=auth_core.TYPE_ACCESS)
    row = employees.get_by_id(claims["sub"])
    if row is None or row["archived_at"] is not None:
        raise Unauthorized("Account is not active.", code="invalid_token")
    audit.set_actor(row["id"])
    return row
