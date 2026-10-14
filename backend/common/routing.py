# Path-prefix handling: strip /api/<service> so routes are written once and match locally and in AWS.

# Locally, bin/proxy-server.js strips "/api/<service>" before calling the Lambda ("/login").
# In AWS, CloudFront forwards the full path ("/api/auth/login"). Both normalize to "/login".


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
