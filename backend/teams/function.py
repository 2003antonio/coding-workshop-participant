# One Lambda per service: this is the teams service, reached at /api/teams/...
# Shared code (auth, db, rbac, errors, ...) lives in backend/common and is copied
# into ./common by scripts/sync-common.sh before deploy; never edit the copy.
"""
Teams service Lambda entry point: a thin adapter around routes.py.

Unpacks the Function URL event, enforces request limits, runs migrations once
per cold start, dispatches, and returns one consistent error shape.
"""

import base64
import binascii
import json
import logging

import routes
from common import audit, responses, routing
from common.errors import ApiError, BadRequest
from common.migrations.runner import run_migrations

# Configure logging for Lambda
logger = logging.getLogger()
logger.setLevel(logging.INFO)

_MAX_BODY_BYTES = 64 * 1024
_migrated = False


def _ensure_migrated() -> None:
    """Apply pending migrations once per cold start (the runner is lock-protected)."""
    global _migrated
    if not _migrated:
        run_migrations()
        _migrated = True


def _headers(event: dict) -> dict:
    return {str(k).lower(): v for k, v in (event.get("headers") or {}).items()}


def _parse_body(event: dict) -> object:
    """Decode (base64 if flagged), size-check and JSON-parse the request body."""
    raw = event.get("body")
    if raw is None or raw == "":
        return None
    if event.get("isBase64Encoded"):
        try:
            raw_bytes = base64.b64decode(raw, validate=True)
        except (binascii.Error, ValueError):
            raise BadRequest("Malformed request body.")
    else:
        raw_bytes = raw.encode("utf-8")
    if len(raw_bytes) > _MAX_BODY_BYTES:
        raise ApiError("Request body too large (max 64 KB).",
                       code="payload_too_large", status_code=413)
    try:
        return json.loads(raw_bytes.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise BadRequest("Malformed JSON body.")


def handler(event=None, context=None):
    """
    Handle one HTTP request for the teams service.

    Args:
        event (dict, optional): The Lambda Function URL event
        context (object, optional): The Lambda context

    Returns:
        dict: A response object with statusCode, headers, and body
    """
    event = event or {}
    audit.ACTOR.set(None)
    method, path = routing.get_route(event, routes.SERVICE_NAME)
    # Log the route pattern ("/{id}"), never the raw path: ids and junk stay out of logs.
    _, _, pattern = routing.find_route(routes.ROUTES, method, path)
    route = pattern or "(unmatched)"
    status = 500
    try:
        _ensure_migrated()
        body = _parse_body(event)
        response = routes.dispatch(method, path, routing.get_query(event), body, _headers(event))
        status = response["statusCode"]
        return response
    except ApiError as exc:
        status = exc.status_code
        return responses.error(exc)
    except Exception as exc:
        # Generic 500 to the client; only the error type goes to the log, since
        # messages and tracebacks can contain submitted data (salaries, passwords).
        logger.error("Unhandled %s on %s %s", type(exc).__name__, method, route)
        return responses.error(ApiError())
    finally:
        # Log only method, route pattern, status, and the actor UUID (if known).
        logger.info("%s %s -> %s actor=%s", method, route, status, audit.ACTOR.get())


# Main entry point for local testing
if __name__ == "__main__":
    print(handler({"rawPath": "/api/teams/", "requestContext": {"http": {"method": "GET"}}}))
