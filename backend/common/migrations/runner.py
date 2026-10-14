"""Idempotent database migrations, run inside the Lambda on first start.

Design:
- Each .sql file in this directory is a migration, applied in filename order.
- Applied versions are recorded in a schema_migrations table, so a file is
  never applied twice.
- A Postgres transaction-level advisory lock serialises concurrent starts, so
  two Lambdas booting at once cannot both run the migrations. The lock releases
  automatically when the transaction ends.
- The same code path runs locally and in the cloud.

pg8000 allows only one statement per execute(), so each .sql file is split into
individual statements on ';'. The .sql files therefore use plain DDL with no
dollar-quoted bodies and no semicolons inside strings or comments.
"""

import logging
import os

from common.db import get_connection

logger = logging.getLogger(__name__)

# Fixed key shared by all instances; any constant works as long as it is stable.
_ADVISORY_LOCK_KEY = 72747270

_MIGRATIONS_DIR = os.path.dirname(os.path.abspath(__file__))


def _discover_migrations():
    """Return [(version, path), ...] ordered by filename."""
    files = [
        f for f in os.listdir(_MIGRATIONS_DIR)
        if f.endswith(".sql")
    ]
    files.sort()
    # version is the leading number, e.g. "001" from "001_init.sql".
    return [(f.split("_", 1)[0], os.path.join(_MIGRATIONS_DIR, f)) for f in files]


def _split_statements(sql_text):
    """Split a .sql file into individual statements.

    Strips line comments (-- ...) then splits on ';'. Safe for plain DDL only.
    """
    lines = []
    for line in sql_text.splitlines():
        idx = line.find("--")
        if idx != -1:
            line = line[:idx]
        lines.append(line)
    cleaned = "\n".join(lines)
    return [s.strip() for s in cleaned.split(";") if s.strip()]


def run_migrations():
    """Apply any pending migrations. Idempotent and concurrency-safe."""
    conn = get_connection()
    cur = conn.cursor()
    try:
        # Transaction-level advisory lock: serialise concurrent boots. Released
        # automatically on commit/rollback.
        cur.execute("SELECT pg_advisory_xact_lock(%s)", (_ADVISORY_LOCK_KEY,))

        cur.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            "  version text PRIMARY KEY,"
            "  applied_at timestamptz NOT NULL DEFAULT now()"
            ")"
        )

        applied = []
        for version, path in _discover_migrations():
            cur.execute(
                "SELECT 1 FROM schema_migrations WHERE version = %s", (version,)
            )
            if cur.fetchone() is not None:
                continue

            with open(path, "r", encoding="utf-8") as fh:
                sql_text = fh.read()
            for statement in _split_statements(sql_text):
                cur.execute(statement)

            cur.execute(
                "INSERT INTO schema_migrations (version) VALUES (%s)", (version,)
            )
            applied.append(version)

        conn.commit()
        if applied:
            logger.info("Applied migrations: %s", ", ".join(applied))
        else:
            logger.info("No pending migrations.")
        return applied
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    done = run_migrations()
    print("Applied:", done if done else "(none - already up to date)")
