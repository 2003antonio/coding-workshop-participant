"""Input validation. Every helper raises BadRequest (400) on failure, so the
error shape stays consistent. Messages name the field, never echo its value.
"""

import re

from common.errors import BadRequest

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_MAX_EMAIL_CHARS = 254


def require_dict(body: object) -> dict:
    """The parsed JSON body must be an object."""
    if not isinstance(body, dict):
        raise BadRequest("Request body must be a JSON object.")
    return body


def require_str(body: dict, field: str, max_length: int = 256, strip: bool = True) -> str:
    """Field must be present, a string, non-empty and at most max_length characters.

    Args:
        body: Parsed JSON object.
        field: Field name.
        max_length: Maximum length in characters.
        strip: Trim surrounding whitespace first. Use False for passwords.
    """
    value = body.get(field)
    if value is None:
        raise BadRequest(f"Missing required field: {field}.")
    if not isinstance(value, str):
        raise BadRequest(f"Field {field} must be a string.")
    if strip:
        value = value.strip()
    if value == "":
        raise BadRequest(f"Field {field} must not be empty.")
    if len(value) > max_length:
        raise BadRequest(f"Field {field} must be at most {max_length} characters.")
    return value


def require_email(body: dict, field: str = "email") -> str:
    """Field must be a plausible email address of at most 254 characters."""
    value = require_str(body, field, max_length=_MAX_EMAIL_CHARS)
    if not _EMAIL_RE.match(value):
        raise BadRequest(f"Field {field} must be a valid email address.")
    return value
