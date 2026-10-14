"""Authentication of requests and role-based access control.

authenticate_request() turns the Bearer access token into the employee's
DATABASE row, so the role used for every decision always comes from the
database, never from the token. require_role() denies by default: access is
granted only when the employee's role is explicitly listed. require_min_role()
grants a role and every role above it in ROLE_ORDER.
"""

import uuid
from typing import Optional

from common import audit, auth, db
from common.errors import Forbidden, Unauthorized

VALID_ROLES = ("admin", "manager", "employee")

# Lowest to highest. A role may do everything the roles before it may do.
ROLE_ORDER = ("employee", "manager", "admin")
_RANK = {role: rank for rank, role in enumerate(ROLE_ORDER)}

_INVALID = ("Invalid token.", "invalid_token")


def _bearer_token(headers: dict) -> str:
    value = (headers or {}).get("authorization") or ""
    if not value.lower().startswith("bearer ") or not value[7:].strip():
        raise Unauthorized("Missing bearer token.", code="unauthorized")
    return value[7:].strip()


def authenticate_request(headers: dict) -> dict:
    """Verify the access token, then load the employee from the database.

    Args:
        headers: Request headers with lower-case names.

    Returns:
        The employee row {id, email, name, role, job_title} from the database.

    Raises:
        Unauthorized: Missing/invalid/expired token, or a missing or archived account.
    """
    claims = auth.decode_access_token(_bearer_token(headers))
    try:
        employee_id = uuid.UUID(claims["sub"])
    except (ValueError, TypeError, AttributeError):
        raise Unauthorized(*_INVALID) from None
    row = db.query_one(
        "SELECT id, email, name, role, job_title, archived_at FROM employees WHERE id = %s",
        (str(employee_id),),
    )
    if row is None or row["archived_at"] is not None:
        raise Unauthorized(*_INVALID)
    audit.set_actor(row["id"])
    return {k: row[k] for k in ("id", "email", "name", "role", "job_title")}


def require_role(employee: Optional[dict], *allowed_roles: str) -> str:
    """Ensure the employee has one of the allowed roles; deny by default.

    Args:
        employee: The row returned by authenticate_request, or None.
        allowed_roles: Roles permitted for this route.

    Returns:
        The employee's role.

    Raises:
        Unauthorized: No employee.
        Forbidden: Unknown role, empty allow-list, or role not allowed.
    """
    if not employee or not isinstance(employee, dict):
        raise Unauthorized()
    role = employee.get("role")
    if role not in VALID_ROLES or role not in allowed_roles:
        raise Forbidden()
    return role


def require_min_role(employee: Optional[dict], min_role: str) -> str:
    """Ensure the employee's role is min_role or higher in ROLE_ORDER.

    Args:
        employee: The row returned by authenticate_request, or None.
        min_role: The lowest role permitted for this route.

    Returns:
        The employee's role.

    Raises:
        ValueError: min_role is not a known role (a bug in the route, never user input).
        Unauthorized: No employee.
        Forbidden: Unknown role, or a role below min_role.
    """
    if min_role not in _RANK:
        raise ValueError(f"Unknown minimum role: {min_role!r}")
    if not employee or not isinstance(employee, dict):
        raise Unauthorized()
    role = employee.get("role")
    if role not in _RANK or _RANK[role] < _RANK[min_role]:
        raise Forbidden()
    return role
