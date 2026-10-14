"""Create one employee account for local testing (role admin by default).

Values come from environment variables, or from prompts when unset; the
password prompt is hidden:
    SEED_EMAIL, SEED_NAME, SEED_JOB_TITLE, SEED_PASSWORD
Nothing secret is printed or logged. Idempotent: an existing email (any case)
is left untouched. Refuses a non-local database unless --allow-remote is given.

Usage (repo root):
    .venv/Scripts/python.exe scripts/seed_admin.py [--role admin|manager|employee] [--allow-remote]
"""

import argparse
import getpass
import os
import sys
from typing import Optional

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "..", "backend"))
sys.path.insert(0, _HERE)

from local_env import load_local_env  # noqa: E402
from common import audit, auth, db  # noqa: E402
from common.migrations.runner import run_migrations  # noqa: E402

ROLES = ("admin", "manager", "employee")
_LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


def _ask(env_name: str, prompt: str) -> str:
    """Return the env var's value, or ask for it (visible input)."""
    return (os.getenv(env_name) or input(prompt)).strip()


def _ask_password() -> str:
    """Return SEED_PASSWORD, or ask twice with hidden input."""
    password = os.getenv("SEED_PASSWORD")
    if password:
        return password
    password = getpass.getpass("Password (hidden): ")
    if getpass.getpass("Repeat password (hidden): ") != password:
        raise ValueError("Passwords do not match.")
    return password


def main(argv: Optional[list] = None) -> int:
    """Seed one account. Returns a process exit code (0 ok, 2 refused or invalid)."""
    parser = argparse.ArgumentParser(description="Create one employee account for local testing.")
    parser.add_argument("--role", choices=ROLES, default="admin")
    parser.add_argument("--allow-remote", action="store_true",
                        help="allow a database host other than localhost")
    args = parser.parse_args(argv)

    load_local_env()
    if os.getenv("POSTGRES_HOST", "localhost") not in _LOCAL_HOSTS and not args.allow_remote:
        print("Refusing to seed: POSTGRES_HOST is not a local database. "
              "Pass --allow-remote if you really mean it.", file=sys.stderr)
        return 2

    try:
        email = _ask("SEED_EMAIL", "Email: ")
        name = _ask("SEED_NAME", "Name: ")
        job_title = _ask("SEED_JOB_TITLE", "Job title: ")
        if not (email and name and job_title):
            raise ValueError("Email, name and job title are required.")
        password_hash = auth.hash_password(_ask_password())
    except ValueError as exc:
        print(f"Not seeded: {exc}", file=sys.stderr)
        return 2

    run_migrations()
    # Seeded accounts get salary 0: the column is required, this is test data.
    row = db.query_one(
        "INSERT INTO employees (email, name, role, password_hash, job_title, salary) "
        "VALUES (%s, %s, %s, %s, %s, 0) "
        "ON CONFLICT ((lower(email))) DO NOTHING RETURNING id",
        (email, name, args.role, password_hash, job_title),
    )
    if row is None:
        print("An account with that email already exists; nothing changed.")
        return 0

    audit.record("employee_seeded", None, "employee", row["id"], {"role": args.role})
    print(f"Created {args.role} account {row['id']}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
