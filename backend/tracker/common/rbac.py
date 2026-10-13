"""Role-based access control. One helper that every route calls.

Deny by default: access is granted only when the caller's role is explicitly
listed in the allowed set. Anything else (no claims, no role, unknown role,
empty allow-list) raises Forbidden.
"""

from common.errors import Forbidden, Unauthorized

VALID_ROLES = ("admin", "manager", "employee")


def require_role(claims, *allowed_roles):
    """Ensure the authenticated caller has one of the allowed roles.

    claims: the decoded access-token claims (dict) or None.
    allowed_roles: the roles permitted for this route.
    Returns the caller's role on success; raises otherwise.
    """
    if not claims or not isinstance(claims, dict):
        raise Unauthorized()

    role = claims.get("role")
    if role not in VALID_ROLES:
        # Unknown or missing role -> deny.
        raise Forbidden()

    if not allowed_roles or role not in allowed_roles:
        # Empty allow-list or role not permitted -> deny by default.
        raise Forbidden()

    return role
