"""Integration tests for common/db.py, migrations and audit against a real PostgreSQL."""

import threading
import time
import uuid

import pg8000.dbapi
import pytest

from common import audit, db
from common.migrations import runner

pytestmark = pytest.mark.integration


def _insert_employee(email="ana@acme.test", name="Ana", role="employee",
                     job_title="Engineer", salary=1000):
    return db.query_one(
        "INSERT INTO employees (email, name, role, password_hash, job_title, salary) "
        "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id, email, name",
        (email, name, role, "not-a-real-hash", job_title, salary),
    )


def _assert_db_error(exc_info, sqlstate, constraint):
    error = exc_info.value.args[0]
    assert error["C"] == sqlstate
    assert error["n"] == constraint


def _table_names():
    rows = db.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
    )
    return {r["table_name"] for r in rows}


def _new_connection(settings):
    return pg8000.dbapi.connect(
        host=settings["host"], port=settings["port"], database="acme_test",
        user=settings["user"], password=settings["password"] or None,
    )


# =====================================================================
# Migrations
# =====================================================================
def test_migrations_apply_once_and_rerun_is_a_no_op(fresh_schema):
    assert runner.run_migrations() == ["001"]
    assert runner.run_migrations() == []
    assert [r["version"] for r in db.query("SELECT version FROM schema_migrations")] == ["001"]
    assert {"employees", "refresh_tokens", "audit_log", "schema_migrations"} <= _table_names()


def test_two_migration_runners_at_once_do_not_conflict(fresh_schema, test_database):
    # Hold the migration lock from a third connection so both runners are
    # guaranteed to be waiting at the same time, then let them go.
    blocker = _new_connection(test_database)
    blocker_cur = blocker.cursor()
    blocker_cur.execute("SELECT pg_advisory_xact_lock(%s)", (runner._ADVISORY_LOCK_KEY,))

    results, errors = [], []

    def run():
        try:
            results.append(runner.run_migrations())
        except Exception as exc:  # pragma: no cover - only on failure
            errors.append(exc)
        finally:
            db.close()

    threads = [threading.Thread(target=run) for _ in range(2)]
    for t in threads:
        t.start()

    deadline = time.monotonic() + 10
    while True:
        blocker_cur.execute(
            "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted"
        )
        if blocker_cur.fetchone()[0] == 2:
            break
        assert time.monotonic() < deadline, "runners never queued on the advisory lock"
        time.sleep(0.05)

    blocker.rollback()  # releases the lock
    for t in threads:
        t.join(timeout=30)
    blocker.close()

    assert errors == []
    assert sorted(results) == [[], ["001"]]
    assert db.query_one("SELECT count(*) AS n FROM schema_migrations")["n"] == 1


# =====================================================================
# Constraints
# =====================================================================
def test_duplicate_email_in_different_case_is_rejected(migrated_db):
    _insert_employee(email="Ana@Acme.test")
    with pytest.raises(pg8000.dbapi.DatabaseError) as exc_info:
        _insert_employee(email="ana@ACME.TEST")
    _assert_db_error(exc_info, "23505", "uq_employees_email_lower")


def test_bad_role_is_rejected(migrated_db):
    with pytest.raises(pg8000.dbapi.DatabaseError) as exc_info:
        _insert_employee(role="superuser")
    _assert_db_error(exc_info, "23514", "employees_role_check")


def test_negative_salary_is_rejected(migrated_db):
    with pytest.raises(pg8000.dbapi.DatabaseError) as exc_info:
        _insert_employee(salary=-1)
    _assert_db_error(exc_info, "23514", "employees_salary_check")


@pytest.mark.parametrize("job_title", ["", "   "], ids=["empty", "spaces"])
def test_blank_job_title_is_rejected(migrated_db, job_title):
    with pytest.raises(pg8000.dbapi.DatabaseError) as exc_info:
        _insert_employee(job_title=job_title)
    _assert_db_error(exc_info, "23514", "employees_job_title_check")


def test_sql_injection_looking_string_is_stored_as_plain_data(migrated_db):
    evil_name = "Robert'); DROP TABLE employees; --"
    evil_email = "x' OR '1'='1@acme.test"
    row = _insert_employee(email=evil_email, name=evil_name)
    assert row["name"] == evil_name
    found = db.query_one("SELECT name FROM employees WHERE email = %s", (evil_email,))
    assert found == {"name": evil_name}
    assert "employees" in _table_names()
    assert db.query_one("SELECT count(*) AS n FROM employees")["n"] == 1


# =====================================================================
# Connection handling and helpers
# =====================================================================
def test_db_reconnects_after_connection_is_killed(migrated_db, test_database):
    old_pid = db.query_one("SELECT pg_backend_pid() AS pid")["pid"]
    killer = _new_connection(test_database)
    killer.autocommit = True
    killer.cursor().execute("SELECT pg_terminate_backend(%s)", (old_pid,))
    killer.close()

    new_pid = db.query_one("SELECT pg_backend_pid() AS pid")["pid"]
    assert new_pid != old_pid


def test_query_one_returns_none_when_no_row(migrated_db):
    assert db.query_one("SELECT id FROM employees WHERE email = %s", ("nobody@acme.test",)) is None


def test_execute_returns_affected_row_count(migrated_db):
    _insert_employee(email="a@acme.test")
    _insert_employee(email="b@acme.test")
    assert db.execute("UPDATE employees SET name = %s", ("Renamed",)) == 2


def test_transaction_commits_on_success(migrated_db):
    with db.transaction():
        _insert_employee(email="a@acme.test")
        _insert_employee(email="b@acme.test")
    assert db.query_one("SELECT count(*) AS n FROM employees")["n"] == 2


def test_transaction_rolls_back_on_python_error(migrated_db):
    with pytest.raises(RuntimeError):
        with db.transaction():
            _insert_employee(email="a@acme.test")
            raise RuntimeError("boom")
    assert db.query_one("SELECT count(*) AS n FROM employees")["n"] == 0


def test_transaction_rolls_back_earlier_work_on_database_error(migrated_db):
    with pytest.raises(pg8000.dbapi.DatabaseError):
        with db.transaction():
            _insert_employee(email="a@acme.test")
            _insert_employee(email="b@acme.test", role="superuser")
    assert db.query_one("SELECT count(*) AS n FROM employees")["n"] == 0


def test_nested_transaction_joins_the_outer_one(migrated_db):
    with pytest.raises(RuntimeError):
        with db.transaction():
            with db.transaction():
                _insert_employee(email="a@acme.test")
            raise RuntimeError("outer fails after inner finished")
    assert db.query_one("SELECT count(*) AS n FROM employees")["n"] == 0


# =====================================================================
# Audit
# =====================================================================
def test_audit_record_stores_ids_and_labels(migrated_db):
    actor, entity = uuid.uuid4(), uuid.uuid4()
    audit.record("login_success", actor, "employee", entity, {"reason": "ok"})
    row = db.query_one("SELECT actor_id, action, entity_type, entity_id, details FROM audit_log")
    assert row == {
        "actor_id": actor, "action": "login_success", "entity_type": "employee",
        "entity_id": entity, "details": {"reason": "ok"},
    }


def test_audit_record_allows_anonymous_actor_and_no_details(migrated_db):
    audit.record("login_failure")
    row = db.query_one("SELECT actor_id, details FROM audit_log")
    assert row == {"actor_id": None, "details": None}


@pytest.mark.parametrize("key", ["password", "refresh_token", "email", "salary"])
def test_audit_record_refuses_sensitive_detail_keys(migrated_db, key):
    with pytest.raises(ValueError):
        audit.record("login_failure", None, None, None, {key: "secret-value"})
    assert db.query_one("SELECT count(*) AS n FROM audit_log")["n"] == 0
