"""Tests for backend/common/routing.py: /api/<service> prefix handling."""

import pytest

from common.routing import find_route, get_query, get_route, match_path, normalize_path


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


# =====================================================================
# Path parameters
# =====================================================================
@pytest.mark.parametrize("pattern, path, expected", [
    ("/", "/", {}),
    ("/{id}", "/abc", {"id": "abc"}),
    ("/{id}/archive", "/abc/archive", {"id": "abc"}),
    ("/{team}/members/{id}", "/t1/members/e2", {"team": "t1", "id": "e2"}),
])
def test_match_path_extracts_parameters(pattern, path, expected):
    assert match_path(pattern, path) == expected


@pytest.mark.parametrize("pattern, path", [
    ("/{id}", "/"),                      # missing segment
    ("/{id}", "/abc/archive"),           # extra segment
    ("/{id}/archive", "/abc/restore"),   # literal differs
    ("/{id}/archive", "/abc"),
    ("/", "/abc"),
    ("/{team}/{id}/archive", "/t1//archive"),  # a parameter never matches an empty segment
])
def test_match_path_rejects_non_matching_paths(pattern, path):
    assert match_path(pattern, path) is None


def _table():
    return {
        ("GET", "/"): "list",
        ("GET", "/me"): "me",
        ("GET", "/{id}"): "get_one",
        ("POST", "/{id}/archive"): "archive",
    }


def test_find_route_prefers_an_exact_match_over_a_parameter():
    assert find_route(_table(), "GET", "/me") == ("me", {}, "/me")


def test_find_route_returns_handler_params_and_pattern():
    assert find_route(_table(), "GET", "/abc") == ("get_one", {"id": "abc"}, "/{id}")
    assert find_route(_table(), "POST", "/abc/archive") == ("archive", {"id": "abc"}, "/{id}/archive")
    assert find_route(_table(), "GET", "/") == ("list", {}, "/")


@pytest.mark.parametrize("method, path", [
    ("DELETE", "/abc"),        # method not in the table
    ("GET", "/abc/archive"),   # pattern exists only for POST
    ("POST", "/abc"),
    ("GET", "/a/b/c"),
])
def test_find_route_without_a_match_returns_nothing(method, path):
    assert find_route(_table(), method, path) == (None, {}, None)


def test_get_query_reads_the_raw_query_string_first():
    event = {"rawQueryString": "include_archived=true&x=1&x=2&blank=",
             "queryStringParameters": {"ignored": "yes"}}
    assert get_query(event) == {"include_archived": "true", "x": "2", "blank": ""}


def test_get_query_falls_back_to_query_string_parameters_or_empty():
    assert get_query({"queryStringParameters": {"a": "1"}}) == {"a": "1"}
    assert get_query({"rawQueryString": ""}) == {}
    assert get_query({}) == {}
