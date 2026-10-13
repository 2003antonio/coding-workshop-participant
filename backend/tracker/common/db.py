"""PostgreSQL access using pg8000 (pure Python).

Connection details come from the environment variables that the workshop
infrastructure injects into every Lambda (see infra/locals.tf). Nothing here
is hardcoded; locally the values are whatever start-dev.sh / Terraform provide.

Rules enforced by this module:
- Parameterised queries only. Callers pass params as a tuple/list; we never
  build SQL with string formatting.
- SSL is required when running in the cloud (IS_LOCAL != "true"), matching the
  Aurora "sslmode=require" guidance in docs/full-stack.md.
- A single connection is reused across Lambda invocations (warm containers).
"""

import os
import ssl

import pg8000.dbapi

# Module-level connection, reused across warm Lambda invocations.
_CONN = None


def _is_local():
    return os.getenv("IS_LOCAL", "false").lower() == "true"


def _connect_kwargs():
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
        # Cloud (Aurora): require TLS. DocumentDB-style invalid certs are
        # tolerated the same way the workshop tolerates them elsewhere.
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        kwargs["ssl_context"] = ctx
    return kwargs


def get_connection():
    """Return a live connection, reconnecting if the pooled one is dead."""
    global _CONN
    if _CONN is not None:
        try:
            cur = _CONN.cursor()
            cur.execute("SELECT 1")
            cur.close()
            return _CONN
        except Exception:
            try:
                _CONN.close()
            except Exception:
                pass
            _CONN = None

    _CONN = pg8000.dbapi.connect(**_connect_kwargs())
    # Explicit transaction control; we commit/rollback ourselves.
    _CONN.autocommit = False
    return _CONN


def _columns(cur):
    return [c[0] for c in cur.description] if cur.description else []


def query(sql, params=()):
    """Run a SELECT and return a list of dict rows. Parameterised only."""
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(sql, params)
        cols = _columns(cur)
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
        conn.commit()
        return rows
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


def query_one(sql, params=()):
    """Run a SELECT and return the first dict row, or None. Parameterised only."""
    rows = query(sql, params)
    return rows[0] if rows else None


def execute(sql, params=()):
    """Run an INSERT/UPDATE/DELETE and commit. Returns affected row count."""
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(sql, params)
        count = cur.rowcount
        conn.commit()
        return count
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
