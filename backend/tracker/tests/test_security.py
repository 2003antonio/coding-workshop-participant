"""Unit tests for the security core: hashing, tokens, and role denial."""

import datetime

import jwt
import pytest

from common import auth
from common.errors import Forbidden, Unauthorized
from common.rbac import require_role


# --- Password hashing ---
def test_hash_and_verify_roundtrip():
    stored = auth.hash_password("correct horse battery staple")
    assert stored.startswith("scrypt$16384$8$1$")
    assert auth.verify_password("correct horse battery staple", stored) is True
    assert auth.verify_password("wrong password", stored) is False


def test_hash_uses_random_salt():
    a = auth.hash_password("same-password")
    b = auth.hash_password("same-password")
    assert a != b  # different random salt each time


# --- Token expiry ---
def test_expired_token_rejected():
    expired = auth._make_token("u1", "admin", auth.TYPE_ACCESS,
                               datetime.timedelta(seconds=-10))
    with pytest.raises(Unauthorized) as exc:
        auth.decode_token(expired)
    assert exc.value.code == "token_expired"


# --- Tampered token ---
def test_tampered_token_rejected():
    token = auth.make_access_token("u1", "admin")
    # Flip a character in the payload segment.
    head, payload, sig = token.split(".")
    payload = payload[:-1] + ("A" if payload[-1] != "A" else "B")
    with pytest.raises(Unauthorized):
        auth.decode_token(f"{head}.{payload}.{sig}")


# --- Wrong token type ---
def test_wrong_token_type_rejected():
    access = auth.make_access_token("u1", "employee")
    with pytest.raises(Unauthorized) as exc:
        auth.decode_token(access, expected_type=auth.TYPE_REFRESH)
    assert exc.value.code == "wrong_token_type"


# --- Wrong algorithm ---
def test_wrong_algorithm_rejected():
    # Sign a token with HS512 using the real key; decode must reject it.
    key = auth._signing_key()
    now = datetime.datetime.now(datetime.timezone.utc)
    forged = jwt.encode(
        {"sub": "u1", "role": "admin", "type": "access",
         "iat": int(now.timestamp()),
         "exp": int((now + datetime.timedelta(minutes=5)).timestamp())},
        key, algorithm="HS512",
    )
    with pytest.raises(Unauthorized):
        auth.decode_token(forged)


def test_none_algorithm_rejected():
    now = datetime.datetime.now(datetime.timezone.utc)
    forged = jwt.encode(
        {"sub": "u1", "role": "admin", "type": "access",
         "iat": int(now.timestamp()),
         "exp": int((now + datetime.timedelta(minutes=5)).timestamp())},
        key=None, algorithm="none",
    )
    with pytest.raises(Unauthorized):
        auth.decode_token(forged)


# --- Role denial (deny by default) ---
def test_role_allowed():
    claims = {"sub": "u1", "role": "admin", "type": "access"}
    assert require_role(claims, "admin", "manager") == "admin"


def test_role_denied():
    claims = {"sub": "u1", "role": "employee", "type": "access"}
    with pytest.raises(Forbidden):
        require_role(claims, "admin")


def test_role_denied_when_no_claims():
    with pytest.raises(Unauthorized):
        require_role(None, "admin")


def test_role_denied_with_empty_allowlist():
    claims = {"sub": "u1", "role": "admin", "type": "access"}
    with pytest.raises(Forbidden):
        require_role(claims)  # deny by default
