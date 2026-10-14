# Path-prefix handling: strip /api/<service> so routes are written once and match locally and in AWS.

# Locally, bin/proxy-server.js strips "/api/<service>" before calling the Lambda ("/login").
# In AWS, CloudFront forwards the full path ("/api/auth/login"). Both normalize to "/login".

from typing import Callable, Optional
from urllib.parse import parse_qsl


def normalize_path(raw_path: str, service_name: str) -> str:
    """Return the route path with any leading /api/<service_name> prefix removed.

    Args:
        raw_path: Path as received by the Lambda (e.g. "/api/auth/login" or "/login").
        service_name: Service folder name, which is also its URL segment (e.g. "auth").

    Returns:
        Path starting with "/" and without a trailing slash (e.g. "/login"), or "/" for the root.
    """
    path = "/" + (raw_path or "").strip("/")
    prefix = f"/api/{service_name}"
    if path == prefix or path.startswith(prefix + "/"):
        path = path[len(prefix):] or "/"
    return path


def get_route(event: dict, service_name: str) -> tuple[str, str]:
    """Extract the HTTP method and normalized path from a Lambda Function URL event.

    Args:
        event: The Lambda event (Function URL payload format 2.0).
        service_name: Service folder name, which is also its URL segment (e.g. "auth").

    Returns:
        Tuple of (method, path), e.g. ("POST", "/login").
    """
    http = (event.get("requestContext") or {}).get("http") or {}
    method = (http.get("method") or event.get("httpMethod") or "GET").upper()
    raw_path = event.get("rawPath") or http.get("path") or event.get("path") or "/"
    return method, normalize_path(raw_path, service_name)


# Path parameters: a route pattern like "/{id}/archive" matches "/abc/archive"
# with params {"id": "abc"}. Each {name} matches exactly one non-empty segment;
# callers still validate the value (e.g. that an id is a UUID).


def _segments(path: str) -> list[str]:
    stripped = (path or "").strip("/")
    return stripped.split("/") if stripped else []


def match_path(pattern: str, path: str) -> Optional[dict]:
    """Match a normalized path against a route pattern.

    Args:
        pattern: Route pattern, e.g. "/{id}/archive" or "/".
        path: Normalized request path, e.g. "/abc/archive".

    Returns:
        Dict of path parameters ({} for a pattern without any), or None if no match.
    """
    pattern_parts, path_parts = _segments(pattern), _segments(path)
    if len(pattern_parts) != len(path_parts):
        return None
    params = {}
    for expected, actual in zip(pattern_parts, path_parts):
        if expected.startswith("{") and expected.endswith("}"):
            if not actual:
                return None
            params[expected[1:-1]] = actual
        elif expected != actual:
            return None
    return params


def find_route(routes: dict, method: str, path: str) -> tuple[Optional[Callable], dict, Optional[str]]:
    """Find the handler for (method, path) in a {(method, pattern): handler} table.

    An exact pattern wins over one with parameters (so "/me" beats "/{id}");
    otherwise patterns are tried in table order.

    Returns:
        (handler, params, pattern), or (None, {}, None) when nothing matches.
        Log the pattern, never the raw path: a path can contain anything.
    """
    handler = routes.get((method, path))
    if handler is not None:
        return handler, {}, path
    for (route_method, pattern), candidate in routes.items():
        if route_method != method or "{" not in pattern:
            continue
        params = match_path(pattern, path)
        if params is not None:
            return candidate, params, pattern
    return None, {}, None


def get_query(event: dict) -> dict:
    """Return the query string as {name: value}; for a repeated name the last value wins."""
    raw = event.get("rawQueryString")
    if raw:
        return dict(parse_qsl(raw, keep_blank_values=True))
    return dict(event.get("queryStringParameters") or {})
