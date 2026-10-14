"""Route table for the auth service: request parsing -> services -> response.

Paths are written once, without the /api/auth prefix; common/routing.py strips
it, so they match both locally and behind CloudFront.
"""

import services
from common import rbac, responses, validation
from common.errors import NotFound

SERVICE_NAME = "auth"


def login(body: object, headers: dict) -> dict:
    data = validation.require_dict(body)
    email = validation.require_email(data, "email")
    password = validation.require_str(data, "password", max_length=256, strip=False)
    return responses.ok(services.login(email, password))


def refresh(body: object, headers: dict) -> dict:
    data = validation.require_dict(body)
    token = validation.require_str(data, "refresh_token", max_length=128)
    return responses.ok(services.refresh(token))


def logout(body: object, headers: dict) -> dict:
    data = validation.require_dict(body)
    token = validation.require_str(data, "refresh_token", max_length=128)
    services.logout(token)
    return responses.no_content()


def me(body: object, headers: dict) -> dict:
    employee = rbac.authenticate_request(headers)
    rbac.require_role(employee, "admin", "manager", "employee")
    return responses.ok(services.me(employee))


ROUTES = {
    ("POST", "/login"): login,
    ("POST", "/refresh"): refresh,
    ("POST", "/logout"): logout,
    ("GET", "/me"): me,
}


def dispatch(method: str, path: str, body: object, headers: dict) -> dict:
    """Call the handler for (method, path); unknown routes raise NotFound (404)."""
    handler = ROUTES.get((method, path))
    if handler is None:
        raise NotFound("Unknown route.", code="not_found")
    return handler(body, headers)
