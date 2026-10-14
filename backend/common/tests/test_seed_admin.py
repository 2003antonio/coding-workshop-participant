"""Integration tests for scripts/seed_admin.py."""

import logging
import os

import pytest

import seed_admin
from common import auth, db

pytestmark = pytest.mark.integration

_PASSWORD = "Seed-Pa55word-do-not-print"


@pytest.fixture
def seed_env(migrated_db, monkeypatch):
    # Isolate from this machine: never read the real .env.local, and drop any
    # SEED_* from the shell, so each test controls exactly what the script sees.
    monkeypatch.setattr(seed_admin, "load_local_env", lambda *args, **kwargs: None)
    for name in [n for n in os.environ if n.startswith("SEED_")]:
        monkeypatch.delenv(name)
    monkeypatch.setenv("SEED_EMAIL", "Admin@Acme.test")
    monkeypatch.setenv("SEED_NAME", "Ada Admin")
    monkeypatch.setenv("SEED_JOB_TITLE", "Head of Delivery")
    monkeypatch.setenv("SEED_PASSWORD", _PASSWORD)
    return monkeypatch


def _employees():
    return db.query("SELECT email, name, role, job_title, salary, password_hash FROM employees")


def test_seed_creates_the_account_once(seed_env, capsys):
    assert seed_admin.main([]) == 0
    rows = _employees()
    assert len(rows) == 1
    row = rows[0]
    assert (row["email"], row["name"], row["role"], row["job_title"]) == (
        "Admin@Acme.test", "Ada Admin", "admin", "Head of Delivery")
    assert row["salary"] == 0
    assert auth.verify_password(_PASSWORD, row["password_hash"])
    assert "Created admin account" in capsys.readouterr().out
    assert db.query_one("SELECT action FROM audit_log") == {"action": "employee_seeded"}


def test_seed_role_flag(seed_env):
    assert seed_admin.main(["--role", "manager"]) == 0
    assert _employees()[0]["role"] == "manager"


def test_seed_is_idempotent_even_with_different_email_case(seed_env, capsys):
    assert seed_admin.main([]) == 0
    seed_env.setenv("SEED_EMAIL", "ADMIN@acme.TEST")
    assert seed_admin.main(["--role", "employee"]) == 0
    rows = _employees()
    assert len(rows) == 1
    assert rows[0]["role"] == "admin"
    assert "already exists; nothing changed" in capsys.readouterr().out


def test_seed_refuses_remote_database_without_flag(seed_env, capsys):
    seed_env.setenv("POSTGRES_HOST", "acme-prod.cluster.example.com")

    def must_not_connect():
        raise AssertionError("seed tried to connect to a remote database")

    seed_env.setattr(db, "get_connection", must_not_connect)
    seed_env.setattr(seed_admin, "run_migrations", must_not_connect)
    assert seed_admin.main([]) == 2
    assert "Refusing to seed" in capsys.readouterr().err


def test_seed_with_allow_remote_flag_gets_past_the_guard(seed_env):
    seed_env.setenv("POSTGRES_HOST", "acme-prod.cluster.example.com")

    class Reached(Exception):
        pass

    def reached():
        raise Reached()

    seed_env.setattr(db, "get_connection", reached)
    seed_env.setattr(seed_admin, "run_migrations", reached)
    with pytest.raises(Reached):
        seed_admin.main(["--allow-remote"])


def test_seed_never_prints_or_logs_the_password(seed_env, capsys, caplog):
    caplog.set_level(logging.DEBUG)
    assert seed_admin.main([]) == 0
    assert seed_admin.main([]) == 0
    out, err = capsys.readouterr()
    for text in (out, err, caplog.text):
        assert _PASSWORD not in text
        assert "Admin@Acme.test" not in text


def test_seed_prompts_hide_the_password(seed_env, capsys):
    seed_env.delenv("SEED_PASSWORD")
    hidden_prompts = []

    def fake_getpass(prompt):
        hidden_prompts.append(prompt)
        return _PASSWORD

    seed_env.setattr(seed_admin.getpass, "getpass", fake_getpass)
    assert seed_admin.main([]) == 0
    assert len(hidden_prompts) == 2  # asked twice, both hidden
    assert _PASSWORD not in capsys.readouterr().out


def test_seed_prompts_for_missing_values(seed_env):
    seed_env.delenv("SEED_NAME")
    seed_env.setattr("builtins.input", lambda prompt: "Prompted Name")
    assert seed_admin.main([]) == 0
    assert _employees()[0]["name"] == "Prompted Name"


def test_seed_rejects_mismatched_password_confirmation(seed_env, capsys):
    seed_env.delenv("SEED_PASSWORD")
    answers = iter([_PASSWORD, "something-else"])
    seed_env.setattr(seed_admin.getpass, "getpass", lambda prompt: next(answers))
    assert seed_admin.main([]) == 2
    assert _employees() == []
    assert "do not match" in capsys.readouterr().err


def test_seed_rejects_missing_job_title(seed_env):
    seed_env.setenv("SEED_JOB_TITLE", "   ")
    seed_env.setattr("builtins.input", lambda prompt: "")
    assert seed_admin.main([]) == 2
    assert _employees() == []
