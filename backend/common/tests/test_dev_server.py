"""scripts/dev_server.py and scripts/service_loader.py: several services in one
process without their same-named modules (routes, services, ...) colliding."""

import http.client
import json
import sys
import threading

import pytest

import dev_server
from service_loader import SERVICE_MODULES, load_service


# =====================================================================
# Loader (no database)
# =====================================================================
def test_each_service_gets_its_own_modules():
    auth_svc, employees_svc = load_service("auth"), load_service("employees")
    assert auth_svc.routes.SERVICE_NAME == "auth"
    assert employees_svc.routes.SERVICE_NAME == "employees"
    for name in SERVICE_MODULES:
        assert getattr(auth_svc, name) is not getattr(employees_svc, name)
    # Each function module dispatches to its own routes, not the other service's.
    assert auth_svc.function.routes is auth_svc.routes
    assert employees_svc.function.routes is employees_svc.routes
    assert employees_svc.routes.services is employees_svc.services


def test_loading_leaves_sys_modules_as_it_was():
    before = {name: sys.modules.get(name) for name in SERVICE_MODULES}
    load_service("employees")
    assert {name: sys.modules.get(name) for name in SERVICE_MODULES} == before


def test_shared_common_is_the_one_in_backend():
    import common
    assert load_service("employees").routes.rbac.__name__ == "common.rbac"
    assert common.__file__.replace("\\", "/").endswith("backend/common/__init__.py")


@pytest.mark.parametrize("name", ["common", "nope", "_examples", "../scripts"])
def test_only_real_services_can_be_loaded(name):
    with pytest.raises(ValueError):
        load_service(name)


@pytest.mark.parametrize("path, expected", [
    ("/api/auth/login", "auth"),
    ("/api/auth", "auth"),
    ("/api/employees/", "employees"),
    ("/api/employees/abc/archive", "employees"),
    ("/api/teams/abc/members/def", "teams"),
    ("/api/projects/abc/deliverables/def/dependencies", "projects"),
    ("/api/authors/x", None),
    ("/api/nope", None),
    ("/login", None),
])
def test_service_for_picks_the_service_from_the_url(path, expected):
    assert dev_server.service_for(path) == expected


def test_cors_allows_the_methods_the_api_uses():
    for method in ("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"):
        assert method in dev_server.ALLOWED_METHODS


# =====================================================================
# Real HTTP round trip (needs PostgreSQL)
# =====================================================================
@pytest.fixture
def server(migrated_db, monkeypatch):
    monkeypatch.setattr(dev_server, "HANDLERS", dev_server.load_handlers())
    httpd = dev_server.ThreadingHTTPServer(("127.0.0.1", 0), dev_server._Handler)
    httpd.daemon_threads = True
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield httpd.server_address[1]
    httpd.shutdown()
    httpd.server_close()


def _request(port, method, path, headers=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    conn.request(method, path, headers=headers or {})
    resp = conn.getresponse()
    body = resp.read().decode("utf-8")
    conn.close()
    return resp.status, dict(resp.getheaders()), json.loads(body) if body else None


@pytest.mark.integration
def test_one_server_routes_to_every_service_by_url(server):
    # Each answers 401 without a token, which proves each request reached a real
    # service handler (the dev server's own fallback is a 404).
    status, _, body = _request(server, "GET", "/api/auth/me")
    assert status == 401 and body["error"]["code"] == "unauthorized"
    status, _, body = _request(server, "GET", "/api/employees/")
    assert status == 401 and body["error"]["code"] == "unauthorized"
    for name in dev_server.SERVICE_NAMES[2:]:
        status, _, body = _request(server, "GET", f"/api/{name}/")
        assert status == 401, name
    status, _, body = _request(server, "GET", "/api/nope/")
    assert status == 404 and body["error"]["code"] == "not_found"


@pytest.mark.integration
def test_preflight_allows_put_from_the_react_dev_server(server):
    status, headers, _ = _request(server, "OPTIONS", "/api/employees/x",
                                  {"Origin": "http://localhost:3000"})
    assert status == 204
    assert headers["Access-Control-Allow-Origin"] == "http://localhost:3000"
    assert "PUT" in headers["Access-Control-Allow-Methods"]


@pytest.mark.integration
def test_unknown_origins_get_no_cors_headers(server):
    _, headers, _ = _request(server, "OPTIONS", "/api/employees/", {"Origin": "http://evil.test"})
    assert "Access-Control-Allow-Origin" not in headers
