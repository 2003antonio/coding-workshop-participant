"""Audit log: who did what, when. Writes to the audit_log table.

Callers pass only non-sensitive data: an actor UUID (or None for anonymous /
system actions), an action label, and optional entity type, entity UUID and
details. Never pass passwords, tokens, email addresses or salaries.
"""

import contextvars
import datetime
import json
from typing import Optional

from common import db

# Set during a request once the actor is known, read by the handler's log line.
ACTOR = contextvars.ContextVar("actor_id", default=None)

# Keys that must never appear in audit details.
_FORBIDDEN_DETAIL_KEYS = frozenset({
    "password", "password_hash", "token", "access_token", "refresh_token", "email", "salary",
})


def set_actor(actor_id: object) -> None:
    """Remember the acting employee's UUID for this request's log line."""
    ACTOR.set(str(actor_id) if actor_id is not None else None)


def record(
    action: str,
    actor_id: object = None,
    entity_type: Optional[str] = None,
    entity_id: object = None,
    details: Optional[dict] = None,
    at: Optional[datetime.datetime] = None,
) -> None:
    """Insert one audit row.

    Args:
        action: Short label, e.g. "login_success".
        actor_id: UUID of the employee acting, or None.
        entity_type: Kind of record acted on, e.g. "employee".
        entity_id: UUID of the record acted on, or None.
        details: Small dict of non-sensitive labels and ids, or None.
        at: When it happened, for back-dated history (the demo seed only); default now.

    Raises:
        ValueError: If details contains a sensitive key.
    """
    if details and _FORBIDDEN_DETAIL_KEYS.intersection(details):
        raise ValueError("Audit details must not contain sensitive fields.")
    db.execute(
        "INSERT INTO audit_log (actor_id, action, entity_type, entity_id, details, created_at) "
        "VALUES (%s, %s, %s, %s, CAST(%s AS jsonb), COALESCE(CAST(%s AS timestamptz), now()))",
        (
            str(actor_id) if actor_id is not None else None,
            action,
            entity_type,
            str(entity_id) if entity_id is not None else None,
            json.dumps(details) if details is not None else None,
            at.isoformat() if at is not None else None,
        ),
    )
