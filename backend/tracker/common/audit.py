"""Audit log: who did what, when. Writes to the audit_log table.

Callers pass only non-sensitive data: an actor UUID (or None for anonymous /
system actions), an action string, and optional entity + details. Never pass
passwords, tokens, or raw submitted email text.
"""

import contextvars
import json

from common import db

# Set during a request once the actor is known, read by the handler's log line.
ACTOR = contextvars.ContextVar("actor_id", default=None)


def set_actor(actor_id):
    ACTOR.set(actor_id)


def record(action, actor_id=None, entity_type=None, entity_id=None, details=None):
    db.execute(
        "INSERT INTO audit_log (actor_id, action, entity_type, entity_id, details) "
        "VALUES (%s, %s, %s, %s, %s)",
        (
            actor_id,
            action,
            entity_type,
            entity_id,
            json.dumps(details) if details is not None else None,
        ),
    )
