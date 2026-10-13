"""Input validation. Every helper raises BadRequest (400) on failure, so the
error shape stays consistent.

Covers the cases called for across the app: missing/null fields, empty strings,
bad email, out-of-range numbers, and date ordering (end >= start).
"""

import datetime
import re

from common.errors import BadRequest

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def require_dict(body):
    """The parsed JSON body must be an object."""
    if not isinstance(body, dict):
        raise BadRequest("Request body must be a JSON object.")
    return body


def require_str(body, field):
    """Field must be present and a non-empty (after strip) string."""
    value = body.get(field)
    if value is None:
        raise BadRequest(f"Missing required field: {field}.")
    if not isinstance(value, str):
        raise BadRequest(f"Field {field} must be a string.")
    value = value.strip()
    if value == "":
        raise BadRequest(f"Field {field} must not be empty.")
    return value


def require_email(body, field="email"):
    value = require_str(body, field)
    if not _EMAIL_RE.match(value):
        raise BadRequest(f"Field {field} must be a valid email address.")
    return value


def require_int_in_range(body, field, minimum, maximum):
    value = body.get(field)
    if value is None:
        raise BadRequest(f"Missing required field: {field}.")
    if isinstance(value, bool) or not isinstance(value, int):
        raise BadRequest(f"Field {field} must be an integer.")
    if value < minimum or value > maximum:
        raise BadRequest(f"Field {field} must be between {minimum} and {maximum}.")
    return value


def require_date(body, field):
    value = body.get(field)
    if value is None:
        raise BadRequest(f"Missing required field: {field}.")
    if not isinstance(value, str):
        raise BadRequest(f"Field {field} must be an ISO date string (YYYY-MM-DD).")
    try:
        return datetime.date.fromisoformat(value)
    except ValueError:
        raise BadRequest(f"Field {field} must be a valid date (YYYY-MM-DD).")


def require_date_order(start, end):
    """end must not be before start."""
    if end < start:
        raise BadRequest("end_date must not be before start_date.")
    return start, end
