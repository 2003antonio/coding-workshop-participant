"""Test helpers for the auth service: call the real Lambda handler with
Function URL-shaped events. Shared DB fixtures live in backend/conftest.py."""

import base64
import json
import os
import sys

import pytest

_AUTH_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_BACKEND = os.path.dirname(_AUTH_DIR)
# After backend/, so `common` is backend/common, never the synced copy.
sys.path.insert(sys.path.index(_BACKEND) + 1, _AUTH_DIR)


def make_event(method, path, body=None, token=None, headers=None, raw_body=None,
               base64_body=False):
    """Build a Lambda Function URL (payload v2) event."""
    hdrs = {"content-type": "application/json"}
    if token is not None:
        hdrs["authorization"] = f"Bearer {token}"
    hdrs.update(headers or {})
    if raw_body is None and body is not None:
        raw_body = json.dumps(body)
    if base64_body and raw_body is not None:
        raw_body = base64.b64encode(raw_body.encode("utf-8")).decode("ascii")
    return {
        "version": "2.0",
        "rawPath": path,
        "headers": hdrs,
        "requestContext": {"http": {"method": method, "path": path}},
        "body": raw_body,
        "isBase64Encoded": base64_body,
    }


class Response:
    def __init__(self, raw):
        self.raw = raw
        self.status = raw["statusCode"]
        self.text = raw.get("body") or ""
        self.json = json.loads(self.text) if self.text else None


@pytest.fixture
def lambda_event():
    """The make_event builder, for tests that call the handler directly."""
    return make_event


@pytest.fixture
def api(migrated_db):
    """Call the auth handler: api("POST", "/api/auth/login", body={...}, token=...)."""
    import function

    def _call(method, path, **kwargs):
        return Response(function.handler(make_event(method, path, **kwargs), None))

    return _call


@pytest.fixture
def login(api):
    """Log an employee in; returns the parsed JSON body (asserts success)."""
    def _login(employee):
        resp = api("POST", "/api/auth/login",
                   body={"email": employee["email"], "password": employee["password"]})
        assert resp.status == 200, resp.text
        return resp.json

    return _login


@pytest.fixture
def scrypt_calls(monkeypatch):
    """Count hashlib.scrypt calls from now on (create employees before using it)."""
    import hashlib

    from common import auth

    real = hashlib.scrypt
    calls = []

    def counting(*args, **kwargs):
        calls.append(kwargs.get("n"))
        return real(*args, **kwargs)

    def start():
        monkeypatch.setattr(auth.hashlib, "scrypt", counting)
        return calls

    return start
