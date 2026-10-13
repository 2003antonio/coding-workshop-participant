"""Route table: match (method, path) to a feature route handler.

The incoming path may or may not carry the "/api/tracker" prefix: locally the
dev proxy strips it, but in AWS CloudFront forwards the full path. We strip an
optional leading "/api/tracker" so routes are written once and work in both.
"""

from auth import routes as auth_routes
from common.errors import NotFound
from employees import routes as employees_routes

_PREFIX = "/api/tracker"

_ROUTES = {
    ("POST", "/auth/login"): auth_routes.login,
    ("POST", "/auth/refresh"): auth_routes.refresh,
    ("POST", "/auth/logout"): auth_routes.logout,
    ("GET", "/employees/me"): employees_routes.me,
}


def normalize_path(path):
    path = path or "/"
    if path == _PREFIX or path == _PREFIX + "/":
        return "/"
    if path.startswith(_PREFIX + "/"):
        path = path[len(_PREFIX):]
    # Drop a trailing slash (except for root) so "/auth/login/" also matches.
    if len(path) > 1 and path.endswith("/"):
        path = path[:-1]
    return path


def dispatch(method, route, body, headers):
    handler = _ROUTES.get((method, route))
    if handler is None:
        raise NotFound("Unknown route.", code="not_found")
    return handler(body, headers)
