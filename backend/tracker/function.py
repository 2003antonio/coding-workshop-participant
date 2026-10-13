"""Single Lambda entry point for the tracker backend.

Every HTTP request for this service hits this one Lambda. This file is a thin
adapter: it unpacks the Function URL event, enforces request limits, runs
migrations on first start, and hands off to router.py, which dispatches to the
feature modules (auth, employees). Shared concerns (auth, validation, errors,
db) live in common/, so features reuse one implementation instead of copying.
"""

import base64
import json
import logging

import router
from common import audit, responses
from common.errors import ApiError, BadRequest
from migrations.runner import run_migrations

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_MAX_BODY_BYTES = 64 * 1024
_migrated = False


def _ensure_migrated():
    global _migrated
    if not _migrated:
        run_migrations()
        _migrated = True


def _method(event):
    http = (event.get("requestContext") or {}).get("http") or {}
    return (http.get("method") or event.get("httpMethod") or "GET").upper()


def _raw_path(event):
    return event.get("rawPath") or event.get("path") or "/"


def _headers(event):
    return {str(k).lower(): v for k, v in (event.get("headers") or {}).items()}


def _parse_body(event):
    raw = event.get("body")
    if raw is None or raw == "":
        return None
    if event.get("isBase64Encoded"):
        try:
            raw_bytes = base64.b64decode(raw)
        except Exception:
            raise BadRequest("Malformed request body.")
    else:
        raw_bytes = raw.encode("utf-8")
    if len(raw_bytes) > _MAX_BODY_BYTES:
        raise BadRequest("Request body too large (max 64 KB).", code="payload_too_large")
    try:
        return json.loads(raw_bytes.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise BadRequest("Malformed JSON body.")


def handler(event=None, context=None):
    event = event or {}
    audit.ACTOR.set(None)
    method = _method(event)
    route = router.normalize_path(_raw_path(event))
    status = 500
    try:
        _ensure_migrated()
        body = _parse_body(event)
        headers = _headers(event)
        response = router.dispatch(method, route, body, headers)
        status = response["statusCode"]
        return response
    except ApiError as exc:
        status = exc.status_code
        return responses.error(exc)
    except Exception:
        # Full detail to server logs only; never to the client, never a body.
        logger.exception("Unhandled error on %s %s", method, route)
        status = 500
        return responses.error(ApiError())
    finally:
        # Log only method, route, status, and the actor UUID (if known).
        logger.info("%s %s -> %s actor=%s", method, route, status, audit.ACTOR.get())
