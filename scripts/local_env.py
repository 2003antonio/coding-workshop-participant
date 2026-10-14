"""Load the repo-root .env.local into os.environ for local scripts and tests.

Local use only: Lambdas get their settings from Terraform, never from this file.
Variables already set in the environment win over values in the file.
"""

import os

_DEFAULT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env.local")


def read_local_env(path: str = _DEFAULT_PATH) -> dict:
    """Return KEY=VALUE pairs from `path` as a dict; a missing file gives {}."""
    values = {}
    if not os.path.exists(path):
        return values
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip()
    return values


def load_local_env(path: str = _DEFAULT_PATH) -> None:
    """Copy values from `path` into os.environ unless already set."""
    for key, value in read_local_env(path).items():
        os.environ.setdefault(key, value)
