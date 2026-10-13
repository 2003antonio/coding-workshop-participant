"""Test setup.

Creates a throwaway `tracker_test` database on the local Postgres, runs the
migrations against it, and points the app's db layer at it. Local DB settings
are read from the committed infra/locals.tf (nothing typed or printed).

Run from backend/tracker:  ../.venv/bin/python -m pytest
"""
import os
import re

import pg8000.dbapi
import pytest

_REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
_TF = open(os.path.join(_REPO, "infra", "locals.tf"), encoding="utf-8").read()


def _local_value(var):
    m = re.search(var + r'\s*=.*?\?\s*"([^"]*)"', _TF)
    return m.group(1) if m else ""


_HOST, _PORT = "localhost", 5432
_ADMIN_DB = _local_value("POSTGRES_NAME") or "postgres"
_USER = _local_value("POSTGRES_USER") or "postgres"
_PASS = _local_value("POSTGRES_PASS")
_TEST_DB = "tracker_test"

# Point the app and the JWT signing key at the test database. Must be set
# before common.db / common.auth are first used.
os.environ.update(
    IS_LOCAL="true", POSTGRES_HOST=_HOST, POSTGRES_PORT=str(_PORT),
    POSTGRES_NAME=_TEST_DB, POSTGRES_USER=_USER, POSTGRES_PASS=_PASS,
)

_DATA_TABLES = (
    "refresh_tokens, audit_log, milestone_assignments, milestone_dependencies, "
    "milestones, project_members, projects, employees"
)


def _admin_conn():
    conn = pg8000.dbapi.connect(host=_HOST, port=_PORT, database=_ADMIN_DB,
                                user=_USER, password=_PASS)
    conn.autocommit = True
    return conn


@pytest.fixture(scope="session", autouse=True)
def _create_test_db():
    admin = _admin_conn()
    cur = admin.cursor()
    cur.execute("DROP DATABASE IF EXISTS " + _TEST_DB)
    cur.execute("CREATE DATABASE " + _TEST_DB)
    cur.close()
    admin.close()

    from migrations.runner import run_migrations
    run_migrations()

    yield

    from common import db
    try:
        db._CONN.close()
    except Exception:
        pass
    admin = _admin_conn()
    cur = admin.cursor()
    cur.execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=%s",
                (_TEST_DB,))
    cur.execute("DROP DATABASE IF EXISTS " + _TEST_DB)
    cur.close()
    admin.close()


@pytest.fixture(autouse=True)
def _clean_tables():
    from common import db
    db.execute("TRUNCATE " + _DATA_TABLES + " RESTART IDENTITY CASCADE")
    yield


@pytest.fixture
def make_employee():
    """Insert an employee and return its row dict (id, email, role, ...)."""
    from common import auth, db

    def _make(email="user@acme.test", password="Sup3r-secret!", role="employee",
              name="Test User", archived=False):
        row = db.query_one(
            "INSERT INTO employees (email, name, role, password_hash) "
            "VALUES (%s, %s, %s, %s) RETURNING id, email, role",
            (email, name, role, auth.hash_password(password)),
        )
        if archived:
            db.execute("UPDATE employees SET archived_at = now() WHERE id = %s", (row["id"],))
        row["password"] = password
        return row

    return _make
