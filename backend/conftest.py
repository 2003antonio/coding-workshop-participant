"""Shared pytest setup for every backend test folder (common/tests, auth/tests).

Unit tests get a fake POSTGRES_PASS. Integration tests (marked `integration`)
use a throwaway database, acme_test, created at the start of the run and
dropped at the end. Real connection settings come from the environment or the
repo-root .env.local; they are never printed.
"""

import os
import sys

import pg8000.dbapi
import pytest

_BACKEND = os.path.dirname(os.path.abspath(__file__))
_SCRIPTS = os.path.abspath(os.path.join(_BACKEND, "..", "scripts"))
# Import `common` the same way a Lambda does: with backend/ on the path.
sys.path.insert(0, _SCRIPTS)
sys.path.insert(0, _BACKEND)

from local_env import read_local_env  # noqa: E402

TEST_POSTGRES_PASS = "test-only-postgres-pass"
TEST_PASSWORD = "Correct-Horse-9"


@pytest.fixture(autouse=True)
def postgres_pass(monkeypatch: pytest.MonkeyPatch) -> str:
    """Set a test-only POSTGRES_PASS for every test; restored automatically afterwards."""
    monkeypatch.setenv("POSTGRES_PASS", TEST_POSTGRES_PASS)
    return TEST_POSTGRES_PASS


def _real_settings() -> dict:
    """Real local DB settings: environment first, then .env.local, then defaults."""
    file_values = read_local_env()

    def get(name: str, default: str) -> str:
        return os.getenv(name) or file_values.get(name) or default

    return {
        "host": get("POSTGRES_HOST", "localhost"),
        "port": int(get("POSTGRES_PORT", "5432")),
        "user": get("POSTGRES_USER", "postgres"),
        "password": get("POSTGRES_PASS", ""),
        "admin_db": get("POSTGRES_NAME", "postgres"),
    }


# Captured at import, before any fixture swaps POSTGRES_PASS for the fake one.
_REAL = _real_settings()


def _admin_connection():
    conn = pg8000.dbapi.connect(
        host=_REAL["host"], port=_REAL["port"], database=_REAL["admin_db"],
        user=_REAL["user"], password=_REAL["password"] or None, timeout=5,
    )
    conn.autocommit = True
    return conn


@pytest.fixture(scope="session")
def test_database() -> dict:
    """Create the throwaway acme_test database for this run; drop it afterwards."""
    try:
        admin = _admin_connection()
    except Exception as exc:
        pytest.skip(
            f"Integration tests skipped: PostgreSQL unreachable at {_REAL['host']}:{_REAL['port']} "
            f"({type(exc).__name__}). Start it with: docker start acme-postgres"
        )
    cur = admin.cursor()
    cur.execute("DROP DATABASE IF EXISTS acme_test WITH (FORCE)")
    cur.execute("CREATE DATABASE acme_test")
    yield _REAL
    from common import db
    db.close()
    cur.execute("DROP DATABASE IF EXISTS acme_test WITH (FORCE)")
    cur.close()
    admin.close()


@pytest.fixture
def db_env(test_database: dict, monkeypatch: pytest.MonkeyPatch):
    """Point common.db (and the JWT key) at acme_test for one test."""
    from common import db
    monkeypatch.setenv("IS_LOCAL", "true")
    monkeypatch.setenv("POSTGRES_HOST", test_database["host"])
    monkeypatch.setenv("POSTGRES_PORT", str(test_database["port"]))
    monkeypatch.setenv("POSTGRES_NAME", "acme_test")
    monkeypatch.setenv("POSTGRES_USER", test_database["user"])
    monkeypatch.setenv("POSTGRES_PASS", test_database["password"])
    db.close()
    yield db
    db.close()


@pytest.fixture
def migrated_db(db_env):
    """acme_test with all migrations applied and every data table empty."""
    from common.migrations.runner import run_migrations
    run_migrations()
    db_env.execute("TRUNCATE refresh_tokens, audit_log, employees CASCADE")
    return db_env


@pytest.fixture
def fresh_schema(db_env):
    """acme_test with an empty public schema: no tables, no migrations applied."""
    db_env.execute("DROP SCHEMA public CASCADE")
    db_env.execute("CREATE SCHEMA public")
    return db_env


@pytest.fixture
def make_employee(migrated_db):
    """Insert an employee and return {id, email, name, role, job_title, password}."""
    from common import auth

    def _make(email="ana@acme.test", password=TEST_PASSWORD, role="employee",
              name="Ana Lima", job_title="Engineer", salary=85000, archived=False):
        row = migrated_db.query_one(
            "INSERT INTO employees (email, name, role, password_hash, job_title, salary, archived_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, CASE WHEN %s THEN now() END) "
            "RETURNING id, email, name, role, job_title",
            (email, name, role, auth.hash_password(password), job_title, salary, archived),
        )
        row["password"] = password
        return row

    return _make
