"""Shared pytest setup for every backend test folder (common/tests, auth/tests).

Unit tests get a fake POSTGRES_PASS. Integration tests (marked `integration`)
use a throwaway database, acme_test, created at the start of the run and
dropped at the end. Real connection settings come from the environment or the
repo-root .env.local; they are never printed.
"""

import datetime
import itertools
import json
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


# =====================================================================
# Calling a service handler (shared by the teams, projects, allocations
# and reports test folders; auth and employees keep their own copies)
# =====================================================================
def make_event(method, path, body=None, token=None, query="", raw_body=None):
    """Build a Lambda Function URL (payload v2) event."""
    headers = {"content-type": "application/json"}
    if token is not None:
        headers["authorization"] = f"Bearer {token}"
    if raw_body is None and body is not None:
        raw_body = json.dumps(body)
    return {
        "version": "2.0",
        "rawPath": path,
        "rawQueryString": query,
        "headers": headers,
        "requestContext": {"http": {"method": method, "path": path}},
        "body": raw_body,
        "isBase64Encoded": False,
    }


class Response:
    def __init__(self, raw):
        self.raw = raw
        self.status = raw["statusCode"]
        self.text = raw.get("body") or ""
        self.json = json.loads(self.text) if self.text else None

    @property
    def code(self):
        """The error code, or None for a success."""
        return (self.json or {}).get("error", {}).get("code")


@pytest.fixture
def call_service(migrated_db):
    """call_service(svc) -> api(method, path, as_=employee_row, body=..., query=...)."""
    from common import auth

    def _for(service):
        def _call(method, path, as_=None, **kwargs):
            if as_ is not None:
                kwargs["token"] = auth.make_access_token(as_["id"], as_["role"])
            return Response(service.function.handler(make_event(method, path, **kwargs), None))
        return _call

    return _for


# =====================================================================
# Test data
# =====================================================================
# A fixed "today" for date rules (a Wednesday). Tests that need it use the
# `today` fixture, which also patches common.weeks.today.
TODAY = datetime.date(2026, 11, 11)


@pytest.fixture
def today(monkeypatch):
    from common import weeks
    monkeypatch.setattr(weeks, "today", lambda: TODAY)
    return TODAY


class Factory:
    """Insert rows straight into the database, bypassing the services."""

    def __init__(self, db, make_employee):
        self.db = db
        self._make_employee = make_employee
        self._seq = itertools.count(1)

    def employee(self, role="employee", name=None, salary=104000, team=None, archived=False,
                 job_title="Engineer"):
        n = next(self._seq)
        row = self._make_employee(email=f"person{n}@acme.test", name=name or f"Person {n:02d}",
                                  role=role, salary=salary, archived=archived, job_title=job_title)
        if team is not None:
            self.db.execute("UPDATE employees SET team_id = %s WHERE id = %s", (team["id"], row["id"]))
        row["team_id"] = team["id"] if team else None
        return row

    def team(self, lead, name=None, members=(), archived=False):
        row = self.db.query_one(
            "INSERT INTO teams (name, lead_id, archived_at) "
            "VALUES (%s, %s, CASE WHEN %s THEN now() END) RETURNING id, name",
            (name or f"Team {next(self._seq)}", lead["id"], archived))
        for member in members:
            self.db.execute("UPDATE employees SET team_id = %s WHERE id = %s", (row["id"], member["id"]))
            member["team_id"] = row["id"]
        return row

    def project(self, team, name=None, status="active", start="2026-11-02", end="2027-03-31",
                archived=False, description=""):
        return self.db.query_one(
            "INSERT INTO projects (team_id, name, description, status, start_date, end_date, archived_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, CASE WHEN %s THEN now() END) RETURNING id, name",
            (team["id"], name or f"Project {next(self._seq)}", description, status, start, end, archived))

    def deliverable(self, project, name=None, start="2026-11-02", due="2026-11-20",
                    status="not_started", depends_on=(), archived=False):
        row = self.db.query_one(
            "INSERT INTO deliverables (project_id, name, start_date, due_date, status, completed_at, "
            "archived_at) VALUES (%s, %s, %s, %s, %s, CASE WHEN %s THEN now() END, "
            "CASE WHEN %s THEN now() END) RETURNING id, name",
            (project["id"], name or f"Deliverable {next(self._seq)}", start, due, status,
             status == "done", archived))
        for dependency in depends_on:
            self.depend(row, dependency)
        return row

    def depend(self, deliverable, on):
        self.db.execute("INSERT INTO deliverable_dependencies (deliverable_id, depends_on_id) "
                        "VALUES (%s, %s)", (deliverable["id"], on["id"]))

    def allocation(self, employee, project, hours=20, start="2026-11-02", end="2026-12-18",
                   archived=False, created_by=None):
        return self.db.query_one(
            "INSERT INTO allocations (employee_id, project_id, hours_per_week, start_date, end_date, "
            "created_by, archived_at) VALUES (%s, %s, %s, %s, %s, %s, CASE WHEN %s THEN now() END) "
            "RETURNING id",
            (employee["id"], project["id"], hours, start, end, (created_by or employee)["id"], archived))


@pytest.fixture
def factory(migrated_db, make_employee):
    return Factory(migrated_db, make_employee)
