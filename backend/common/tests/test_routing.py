"""Tests for backend/common/routing.py: /api/<service> prefix handling."""

from common.routing import get_route, normalize_path


def test_local_style_path_is_unchanged():
    # Locally the proxy has already stripped /api/auth.
    assert normalize_path("/login", "auth") == "/login"


def test_aws_style_path_has_service_prefix_stripped():
    # In AWS, CloudFront forwards the full path.
    assert normalize_path("/api/auth/login", "auth") == "/login"
    assert normalize_path("/api/auth", "auth") == "/"


def test_trailing_slash_is_removed():
    assert normalize_path("/api/auth/users/7/", "auth") == "/users/7"
    assert normalize_path("/login/", "auth") == "/login"
    assert normalize_path("/api/auth/", "auth") == "/"


def test_unknown_prefix_is_left_alone():
    assert normalize_path("/api/projects/1", "auth") == "/api/projects/1"
    # A service whose name merely starts with "auth" is not this service.
    assert normalize_path("/api/authors/x", "auth") == "/api/authors/x"


def test_empty_or_missing_path_is_root():
    assert normalize_path("", "auth") == "/"
    assert normalize_path(None, "auth") == "/"


def test_get_route_extracts_method_and_path_from_function_url_event():
    event = {
        "rawPath": "/api/auth/login",
        "requestContext": {"http": {"method": "post", "path": "/api/auth/login"}},
    }
    assert get_route(event, "auth") == ("POST", "/login")


def test_get_route_falls_back_to_v1_fields_and_defaults():
    assert get_route({"httpMethod": "delete", "path": "/api/auth/sessions"}, "auth") == ("DELETE", "/sessions")
    assert get_route({}, "auth") == ("GET", "/")
