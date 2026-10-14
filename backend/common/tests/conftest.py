"""Shared pytest setup for backend/common tests."""

import os
import sys

import pytest

# Import `common` the same way a Lambda does: with backend/ on the path.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

TEST_POSTGRES_PASS = "test-only-postgres-pass"


@pytest.fixture(autouse=True)
def postgres_pass(monkeypatch: pytest.MonkeyPatch) -> str:
    """Set a test-only POSTGRES_PASS for every test; restored automatically afterwards."""
    monkeypatch.setenv("POSTGRES_PASS", TEST_POSTGRES_PASS)
    return TEST_POSTGRES_PASS
