"""PostgreSQL access using pg8000 (pure Python).

Connection details come from the environment variables that the workshop
infrastructure injects into every Lambda (POSTGRES_HOST/PORT/NAME/USER/PASS,
IS_LOCAL). Nothing here is hardcoded.

Rules enforced by this module:
- Parameterised queries only. Callers pass params as a tuple/list; we never
  build SQL with string formatting.
- TLS is required when running in the cloud (IS_LOCAL != "true").
- One connection is reused across warm Lambda invocations (one per thread, so
  local tools that use threads never share a connection).
- transaction() groups several helper calls: commit on success, roll back on
  any error. Outside it, every helper call commits on its own.
"""

import contextlib
import os
import ssl
import threading
from typing import Iterator, Optional, Sequence

import pg8000.dbapi

_STATE = threading.local()


def _is_local() -> bool:
    return os.getenv("IS_LOCAL", "false").lower() == "true"


def _connect_kwargs() -> dict:
    """Build pg8000 connect kwargs from the environment."""
    kwargs = {
        "host": os.getenv("POSTGRES_HOST", "localhost"),
        "port": int(os.getenv("POSTGRES_PORT", "5432")),
        "database": os.getenv("POSTGRES_NAME", "postgres"),
        "user": os.getenv("POSTGRES_USER", "postgres"),
        "password": os.getenv("POSTGRES_PASS") or None,
        "timeout": 15,
    }
    if not _is_local():
        # Cloud (Aurora): TLS is required so traffic is encrypted. The server
        # certificate is not verified (CERT_NONE) because the Lambda package does
        # not ship the RDS CA bundle; the connection stays inside the VPC. Bundle
        # the CA and switch to CERT_REQUIRED to also verify the server's identity.
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        kwargs["ssl_context"] = ctx
    return kwargs


def _in_transaction() -> bool:
    return getattr(_STATE, "depth", 0) > 0


def _safe_rollback(conn) -> None:
    try:
        conn.rollback()
    except Exception:
        pass  # A dead connection cannot roll back; the server already discarded the work.


def close() -> None:
    """Close this thread's connection, if any. The next helper call reconnects."""
    conn = getattr(_STATE, "conn", None)
    _STATE.conn = None
    _STATE.depth = 0
    if conn is not None:
        try:
            conn.close()
        except Exception:
            pass


def get_connection():
    """Return a live connection, reconnecting if the reused one is dead.

    The SELECT 1 liveness check is skipped inside transaction(): reconnecting
    there would silently lose the open transaction.
    """
    conn = getattr(_STATE, "conn", None)
    if conn is not None:
        if _in_transaction():
            return conn
        try:
            cur = conn.cursor()
            cur.execute("SELECT 1")
            cur.close()
            return conn
        except Exception:
            close()

    conn = pg8000.dbapi.connect(**_connect_kwargs())
    # Explicit transaction control; we commit/rollback ourselves.
    conn.autocommit = False
    _STATE.conn = conn
    _STATE.depth = 0
    return conn


def _run(sql: str, params: Sequence, fetch: bool):
    """Execute one parameterised statement; commit unless inside transaction()."""
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(sql, params)
        if fetch:
            cols = [c[0] for c in cur.description] if cur.description else []
            result = [dict(zip(cols, r)) for r in cur.fetchall()]
        else:
            result = cur.rowcount
    except Exception:
        if not _in_transaction():
            _safe_rollback(conn)
        raise
    finally:
        cur.close()
    if not _in_transaction():
        conn.commit()
    return result


def query(sql: str, params: Sequence = ()) -> list:
    """Run a statement and return a list of dict rows. Parameterised only."""
    return _run(sql, params, fetch=True)


def query_one(sql: str, params: Sequence = ()) -> Optional[dict]:
    """Run a statement and return the first dict row, or None. Parameterised only."""
    rows = query(sql, params)
    return rows[0] if rows else None


def execute(sql: str, params: Sequence = ()) -> int:
    """Run an INSERT/UPDATE/DELETE. Returns the affected row count. Parameterised only."""
    return _run(sql, params, fetch=False)


@contextlib.contextmanager
def transaction() -> Iterator[None]:
    """Run the enclosed helper calls as one transaction.

    Commits when the block finishes, rolls back on any exception (then
    re-raises it). A nested transaction() joins the outer one.
    """
    conn = get_connection()
    depth = getattr(_STATE, "depth", 0)
    _STATE.depth = depth + 1
    try:
        yield
    except BaseException:
        _STATE.depth = depth
        if depth == 0:
            _safe_rollback(conn)
        raise
    _STATE.depth = depth
    if depth == 0:
        conn.commit()
