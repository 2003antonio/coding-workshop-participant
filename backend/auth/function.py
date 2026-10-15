# One Lambda per service: this is the auth service, reached at /api/auth/...
# Shared code (auth, db, rbac, errors, ...) lives in backend/common and is copied
# into ./common by scripts/sync-common.sh before deploy; never edit the copy.
"""
Auth service Lambda entry point: a thin adapter around routes.py.

Unpacks the Function URL event, enforces request limits, runs migrations once
per cold start, dispatches, and returns one consistent error shape. A direct
invoke (never the public URL) can also seed the demo data; see _direct_invoke.
"""

import base64
import binascii
import json
import logging

import routes
from common import audit, demo_bulk, demo_seed, responses, routing
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


def _is_direct_invoke(event: dict) -> bool:
    """True for `aws lambda invoke`, which needs IAM permission on this function.

    A Function URL request (and so anything through CloudFront) always carries
    requestContext, so the public URL can never reach the direct actions.
    """
    return "requestContext" not in event and "action" in event


def _direct_invoke(event: dict) -> dict:
    """Run an operator action. The only one is seed_demo, for the cloud database.

    Event: {"action": "seed_demo", "passwords": {"admin": ..., "manager": ..., "employee": ...},
            "bulk": true (optional: also the large demo, see common/demo_bulk.py),
            "reset": true (optional: first remove all demo data, as seed_demo.py --reset;
                           refused if any account is outside the demo domain)}.
    Idempotent: each demo already present is left unchanged. Passwords are never
    logged or returned.
    """
    action = event.get("action")
    if action != "seed_demo":
        logger.info("direct invoke: unknown action")
        return {"ok": False, "error": "Unknown action; the only one is seed_demo."}
    if not demo_seed.valid_passwords(event.get("passwords")):
        logger.info("direct invoke seed_demo -> refused (passwords)")
        return {"ok": False, "error": "passwords must give admin, manager and employee, each at "
                                      f"least {demo_seed.MIN_PASSWORD} characters."}
    try:
        _ensure_migrated()
        if event.get("reset") is True:
            refused = demo_seed.reset()
            if refused:
                logger.info("direct invoke seed_demo -> refused (reset)")
                return {"ok": False, "error": f"Refusing to reset: {refused}."}
        if demo_seed.is_seeded():
            result = {"ok": True, "seeded": False,
                      "message": "Demo data already present; nothing changed."}
        else:
            result = {"ok": True, "seeded": True, "counts": demo_seed.seed(event["passwords"])}
        if event.get("bulk") is True:
            if demo_bulk.is_seeded():
                result["bulk"] = {"seeded": False, "message": "Large demo already present; nothing changed."}
            else:
                result["bulk"] = {"seeded": True, "counts": demo_bulk.seed(event["passwords"])}
    except Exception as exc:
        # Same rule as HTTP requests: only the error type is logged.
        logger.error("direct invoke seed_demo -> unhandled %s", type(exc).__name__)
        return {"ok": False, "error": f"Seeding failed ({type(exc).__name__}); see the function's log."}
    logger.info("direct invoke seed_demo -> seeded=%s bulk=%s", result["seeded"],
                result["bulk"]["seeded"] if "bulk" in result else None)
    result["accounts"] = [{"role": role, "email": address} for role, address in demo_seed.accounts()]
    return result


def handler(event=None, context=None):
    """
    Handle one HTTP request for the auth service.

    Args:
        event (dict, optional): The Lambda Function URL event
        context (object, optional): The Lambda context

    Returns:
        dict: A response object with statusCode, headers, and body
    """
    event = event or {}
    audit.ACTOR.set(None)
    if _is_direct_invoke(event):
        return _direct_invoke(event)
    method, path = routing.get_route(event, routes.SERVICE_NAME)
    # Log only known routes: an unknown path could contain anything.
    route = path if (method, path) in routes.ROUTES else "(unmatched)"
    status = 500
    try:
        _ensure_migrated()
        body = _parse_body(event)
        response = routes.dispatch(method, path, body, _headers(event))
        status = response["statusCode"]
        return response
    except ApiError as exc:
        status = exc.status_code
        return responses.error(exc)
    except Exception as exc:
        # Generic 500 to the client; only the error type goes to the log, since
        # messages and tracebacks can contain submitted data.
        logger.error("Unhandled %s on %s %s", type(exc).__name__, method, route)
        return responses.error(ApiError())
    finally:
        # Log only method, route, status, and the actor UUID (if known).
        logger.info("%s %s -> %s actor=%s", method, route, status, audit.ACTOR.get())


# Main entry point for local testing
if __name__ == "__main__":
    print(handler({"rawPath": "/api/auth/me", "requestContext": {"http": {"method": "GET"}}}))
