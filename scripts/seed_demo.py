"""Seed a small demo organisation into the LOCAL database. LOCAL USE ONLY.

The organisation itself (people, teams, projects, deliverables, allocations,
history) is defined in backend/common/demo_seed.py; this script is the local
command-line wrapper around it. For the cloud database, use
scripts/seed-cloud.sh (README, "How to deploy to AWS").

Passwords come from environment variables (or .env.local), one per role, and
are never printed or logged:
    DEMO_ADMIN_PASSWORD, DEMO_MANAGER_PASSWORD, DEMO_EMPLOYEE_PASSWORD
Each must be at least 12 characters.

Refuses any database host other than localhost. Idempotent: if the demo admin
already exists, nothing is changed. --bulk also adds the large demo
(backend/common/demo_bulk.py: 500 people, 30 teams, 210 projects), once. With --reset, every employee, team,
project, deliverable, allocation and refresh token is removed first (the audit
log is kept), so the demo starts clean; it refuses if the database holds any
account outside the demo domain.

Usage (repo root):
    .venv/Scripts/python.exe scripts/seed_demo.py [--reset] [--bulk]    (Windows)
    .venv/bin/python scripts/seed_demo.py [--reset] [--bulk]            (Linux / macOS)
"""

import argparse
import os
import sys
from typing import Optional

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "..", "backend"))
sys.path.insert(0, _HERE)

from local_env import load_local_env  # noqa: E402
from common import demo_bulk, demo_seed  # noqa: E402
from common.migrations.runner import run_migrations  # noqa: E402

_LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
PASSWORD_VARS = {"admin": "DEMO_ADMIN_PASSWORD", "manager": "DEMO_MANAGER_PASSWORD",
                 "employee": "DEMO_EMPLOYEE_PASSWORD"}


def _passwords() -> Optional[dict]:
    """The three role passwords from the environment, or None if any is missing or short."""
    values = {role: os.getenv(var, "") for role, var in PASSWORD_VARS.items()}
    return values if demo_seed.valid_passwords(values) else None


def main(argv: Optional[list] = None) -> int:
    """Seed the demo. Returns a process exit code (0 ok or already seeded, 2 refused)."""
    parser = argparse.ArgumentParser(description="Seed the local demo organisation.")
    parser.add_argument("--reset", action="store_true",
                        help="remove all employees, teams, projects and allocations first")
    parser.add_argument("--bulk", action="store_true",
                        help="also add the large demo: 500 people, 30 teams, 210 projects")
    args = parser.parse_args(argv)
    load_local_env()
    if os.getenv("POSTGRES_HOST", "localhost") not in _LOCAL_HOSTS:
        print("Refusing to seed: POSTGRES_HOST is not a local database.", file=sys.stderr)
        return 2
    passwords = _passwords()
    if passwords is None:
        print("Not seeded: set " + ", ".join(PASSWORD_VARS.values())
              + f" (each at least {demo_seed.MIN_PASSWORD} characters).", file=sys.stderr)
        return 2

    run_migrations()
    if args.reset:
        refused = demo_seed.reset()
        if refused:
            print(f"Refusing to reset: {refused}.", file=sys.stderr)
            return 2
        print("Demo data removed.")
    if demo_seed.is_seeded():
        print("Demo data already present; nothing changed.")
    else:
        counts = demo_seed.seed(passwords)
        print("Seeded demo: " + ", ".join(f"{n} {kind}" for kind, n in counts.items()) + ".")
        print("Log in as (password from the matching DEMO_*_PASSWORD variable):")
        for role, address in demo_seed.accounts():
            print(f"  {role:<9} {address}")
    if args.bulk:
        if demo_bulk.is_seeded():
            print("Large demo already present; nothing changed.")
        else:
            counts = demo_bulk.seed(passwords)
            print("Seeded large demo: " + ", ".join(f"{n} {kind}" for kind, n in counts.items())
                  + ". Its people sign in as first.last@" + demo_seed.DOMAIN
                  + " with their role's password.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
