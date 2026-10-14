"""Input validation. Every helper raises BadRequest (400) on failure, so the
error shape stays consistent. Messages name the field, never echo its value.
"""

import datetime
import math
import re
import uuid
from decimal import Decimal
from typing import Optional

from common.errors import BadRequest, NotFound

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


def reject_unknown_fields(data: dict, allowed) -> None:
    """Refuse fields outside `allowed`. Field names come from the client, so they are not echoed."""
    if set(data) - set(allowed):
        raise BadRequest("Request body contains unknown fields.")


def flag(query: dict, name: str) -> bool:
    """A query flag: absent or "false" is False, "true" is True, anything else is a 400."""
    value = query.get(name)
    if value is None or value == "false":
        return False
    if value == "true":
        return True
    raise BadRequest(f"Query parameter {name} must be true or false.")


def parse_uuid(value: object) -> Optional[str]:
    """Return value as a canonical UUID string, or None if it is not one."""
    if not isinstance(value, str):
        return None
    try:
        return str(uuid.UUID(value))
    except ValueError:
        return None


def path_uuid(params: dict, name: str = "id") -> str:
    """A {name} path parameter as a canonical UUID; anything else is a 404."""
    value = parse_uuid(params.get(name))
    if value is None:
        raise NotFound("Not found.", code="not_found")
    return value


def require_uuid(body: dict, field: str, code: str = "bad_request") -> str:
    """Field must be a UUID string. A missing or non-string field is a plain 400;
    a string that is not a UUID gets `code` (e.g. "invalid_lead")."""
    value = body.get(field)
    if value is None:
        raise BadRequest(f"Missing required field: {field}.")
    if not isinstance(value, str):
        raise BadRequest(f"Field {field} must be a string.")
    parsed = parse_uuid(value)
    if parsed is None:
        raise BadRequest(f"Field {field} does not refer to a valid record.", code=code)
    return parsed


def query_uuid(query: dict, name: str) -> Optional[str]:
    """An optional query parameter that must be a UUID when given."""
    value = query.get(name)
    if value is None:
        return None
    parsed = parse_uuid(value)
    if parsed is None:
        raise BadRequest(f"Query parameter {name} must be a UUID.")
    return parsed


def _date(value: object, label: str) -> datetime.date:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise BadRequest(f"{label} must be a date (YYYY-MM-DD).")
    try:
        return datetime.date.fromisoformat(value)
    except ValueError:
        raise BadRequest(f"{label} must be a date (YYYY-MM-DD).") from None


def require_date(body: dict, field: str) -> datetime.date:
    """Field must be a YYYY-MM-DD string that is a real calendar date."""
    if body.get(field) is None:
        raise BadRequest(f"Missing required field: {field}.")
    return _date(body[field], f"Field {field}")


def query_date(query: dict, name: str) -> Optional[datetime.date]:
    """An optional YYYY-MM-DD query parameter."""
    value = query.get(name)
    return None if value is None else _date(value, f"Query parameter {name}")


def optional_text(body: dict, field: str, max_length: int) -> str:
    """An optional free-text field: a string, trimmed, may be empty. Absent gives ""."""
    value = body.get(field, "")
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise BadRequest(f"Field {field} must be a string.")
    value = value.strip()
    if len(value) > max_length:
        raise BadRequest(f"Field {field} must be at most {max_length} characters.")
    return value


def require_choice(body: dict, field: str, choices) -> str:
    """Field must be one of `choices` (exact case)."""
    value = require_str(body, field, max_length=50)
    if value not in choices:
        raise BadRequest(f"Field {field} must be one of: {', '.join(choices)}.")
    return value


def require_int(body: dict, field: str, low: int, high: int) -> int:
    """Field must be a whole JSON number from low to high (booleans and 20.5 refused)."""
    value = body.get(field)
    if value is None:
        raise BadRequest(f"Missing required field: {field}.")
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise BadRequest(f"Field {field} must be a whole number from {low} to {high}.")
    return value


_MAX_MONEY = Decimal("9999999999.99")   # numeric(12, 2)


def optional_money(body: dict, field: str) -> Optional[Decimal]:
    """A JSON number from 0 to 9,999,999,999.99 with at most two decimals, or null."""
    value = body.get(field)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or \
            (isinstance(value, float) and not math.isfinite(value)):
        raise BadRequest(f"Field {field} must be a number.")
    amount = Decimal(str(value))
    if amount < 0 or amount > _MAX_MONEY:
        raise BadRequest(f"Field {field} must be between 0 and 9999999999.99.")
    if amount != amount.quantize(Decimal("0.01")):
        raise BadRequest(f"Field {field} must have at most two decimal places.")
    return amount.quantize(Decimal("0.01"))
