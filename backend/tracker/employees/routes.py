"""Employee routes."""

from auth.services import authenticate
from common import responses
from common.rbac import require_role
from employees import services


def me(body, headers):
    # Authenticate -> load employee from DB. RBAC uses the DB role, not the token.
    current = authenticate(headers)
    require_role(current, "admin", "manager", "employee")
    return responses.ok(services.public_view(current))
