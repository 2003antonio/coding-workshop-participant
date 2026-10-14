"""Tests for backend/common/auth.py: passwords, access tokens and refresh token helpers."""

import base64
import datetime
import hashlib
import hmac
import json

import jwt
import pytest

from common import auth
from common.errors import Unauthorized


# =====================================================================
# Helpers
# =====================================================================
def _make_hash(password: str, n: int, r: int, p: int, salt: bytes = b"0123456789abcdef") -> str:
    """Build a scrypt$N$r$p$salt$dk string directly, bypassing hash_password's rules."""
    dk = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=n, r=r, p=p,
        maxmem=64 * 1024 * 1024, dklen=32,
    )
    return f"scrypt${n}${r}${p}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def _now() -> int:
    return int(datetime.datetime.now(datetime.timezone.utc).timestamp())


def _claims(drop: tuple = (), **overrides) -> dict:
    """Valid access-token claims, with optional overrides and claims removed."""
    claims = {"sub": "42", "role": "admin", "type": "access", "iat": _now(), "exp": _now() + 900}
    claims.update(overrides)
    for name in drop:
        claims.pop(name)
    return claims


def _encode(claims: dict, algorithm: str = "HS256") -> str:
    """Sign claims with the real derived key (so only the thing under test is wrong)."""
    return jwt.encode(claims, auth._signing_key(), algorithm=algorithm)


def _assert_rejected(token: object, code: str) -> None:
    """Assert decode_access_token raises Unauthorized with `code` and does not echo the token."""
    with pytest.raises(Unauthorized) as exc:
        auth.decode_access_token(token)
    assert exc.value.code == code
    assert exc.value.status_code == 401
    if isinstance(token, str) and token:
        assert token not in exc.value.message
        assert token not in str(exc.value)


# A fast-to-verify hash (N=2^12) for tests that only need *a* valid hash.
_GOOD_HASH = _make_hash("pw", n=2 ** 12, r=8, p=1)


# =====================================================================
# Passwords
# =====================================================================
def test_password_round_trip():
    stored = auth.hash_password("correct horse battery staple")
    assert auth.verify_password("correct horse battery staple", stored) is True


def test_wrong_password_fails():
    stored = auth.hash_password("right-password")
    assert auth.verify_password("wrong-password", stored) is False


def test_same_password_hashed_twice_gives_different_hashes():
    first = auth.hash_password("same-password")
    second = auth.hash_password("same-password")
    assert first != second
    assert auth.verify_password("same-password", first)
    assert auth.verify_password("same-password", second)


def test_hash_string_contains_its_parameters():
    scheme, n, r, p, salt_b64, dk_b64 = auth.hash_password("pw").split("$")
    assert (scheme, n, r, p) == ("scrypt", "16384", "8", "1")
    assert len(base64.b64decode(salt_b64)) == 16
    assert len(base64.b64decode(dk_b64)) == 32


def test_hash_made_with_different_parameters_still_verifies():
    stored = _make_hash("legacy-password", n=2 ** 12, r=4, p=2)
    assert auth.verify_password("legacy-password", stored) is True
    assert auth.verify_password("not-it", stored) is False


_SALT, _DK = _GOOD_HASH.split("$")[4:]


@pytest.mark.parametrize("stored", [
    pytest.param("", id="empty"),
    pytest.param(None, id="none"),
    pytest.param(12345, id="not-a-string"),
    pytest.param(f"bcrypt$4096$8$1${_SALT}${_DK}", id="wrong-prefix"),
    pytest.param(f"scrypt$4096$8$1${_SALT}", id="missing-dk"),
    pytest.param("scrypt$4096$8$1", id="missing-salt-and-dk"),
    pytest.param("scrypt", id="prefix-only"),
    pytest.param(f"scrypt$4096$8$1${_SALT}${_DK}$extra", id="too-many-parts"),
    pytest.param(f"scrypt$abc$8$1${_SALT}${_DK}", id="non-numeric-n"),
    pytest.param(f"scrypt$4096$x$1${_SALT}${_DK}", id="non-numeric-r"),
    pytest.param(f"scrypt$4096$8$1.5${_SALT}${_DK}", id="non-numeric-p"),
    pytest.param(f"scrypt$0$8$1${_SALT}${_DK}", id="zero-n"),
    pytest.param(f"scrypt$-4096$8$1${_SALT}${_DK}", id="negative-n"),
    pytest.param(f"scrypt$4097$8$1${_SALT}${_DK}", id="n-not-power-of-two"),
    pytest.param(f"scrypt$4096$8$1$!!not-base64!!${_DK}", id="bad-base64-salt"),
    pytest.param(f"scrypt$4096$8$1${_SALT}$%%%", id="bad-base64-dk"),
    pytest.param("scrypt$4096$8$1$$", id="empty-salt-and-dk"),
])
def test_malformed_hash_returns_false_without_raising(stored):
    assert auth.verify_password("pw", stored) is False


@pytest.mark.parametrize("n, r, p", [
    pytest.param(2 ** 17, 8, 1, id="n-above-cap"),
    pytest.param(2 ** 14, 17, 1, id="r-above-cap"),
    pytest.param(2 ** 14, 8, 17, id="p-above-cap"),
    pytest.param(2 ** 30, 2 ** 20, 2 ** 20, id="all-huge"),
])
def test_parameters_above_cap_return_false_without_running_scrypt(monkeypatch, n, r, p):
    def scrypt_must_not_run(*args, **kwargs):
        raise AssertionError("scrypt was called for an over-limit hash")

    monkeypatch.setattr(auth.hashlib, "scrypt", scrypt_must_not_run)
    assert auth.verify_password("pw", f"scrypt${n}${r}${p}${_SALT}${_DK}") is False


@pytest.mark.parametrize("password", [
    pytest.param("", id="empty"),
    pytest.param(None, id="none"),
    pytest.param("x" * 257, id="over-256-chars"),
])
def test_hash_password_rejects_bad_passwords(password):
    with pytest.raises(ValueError):
        auth.hash_password(password)


@pytest.mark.parametrize("password", [
    pytest.param("", id="empty"),
    pytest.param("x" * 257, id="over-256-chars"),
])
def test_verify_password_rejects_bad_passwords_even_if_hash_matches(password):
    # The hash really is for this password, so only the length rule can reject it.
    assert auth.verify_password(password, _make_hash(password, n=2 ** 12, r=8, p=1)) is False


def test_verify_password_rejects_none_password():
    assert auth.verify_password(None, _GOOD_HASH) is False


def test_password_of_exactly_256_chars_is_accepted():
    password = "x" * 256
    assert auth.verify_password(password, auth.hash_password(password)) is True


def test_dummy_verify_returns_false_and_spends_one_scrypt(monkeypatch):
    real_scrypt = hashlib.scrypt
    calls = []

    def counting_scrypt(*args, **kwargs):
        calls.append(kwargs["n"])
        return real_scrypt(*args, **kwargs)

    monkeypatch.setattr(auth.hashlib, "scrypt", counting_scrypt)
    assert auth.dummy_verify() is False
    assert calls == [2 ** 14]


# =====================================================================
# Access tokens
# =====================================================================
def test_access_token_round_trip_returns_claims():
    claims = auth.decode_access_token(auth.make_access_token(42, "project_manager"))
    assert claims["sub"] == "42"
    assert claims["role"] == "project_manager"
    assert claims["type"] == "access"
    assert claims["exp"] - claims["iat"] == 15 * 60


def test_access_token_is_hs256_and_has_no_email_or_salary():
    token = auth.make_access_token(7, "member")
    assert jwt.get_unverified_header(token)["alg"] == "HS256"
    payload = jwt.decode(token, options={"verify_signature": False})
    assert set(payload) == {"sub", "role", "type", "iat", "exp"}
    assert "email" not in payload
    assert "salary" not in payload


def test_expired_token_raises_token_expired():
    _assert_rejected(_encode(_claims(iat=_now() - 1000, exp=_now() - 10)), "token_expired")


def test_tampered_payload_raises_invalid_token():
    header, payload, signature = auth.make_access_token(42, "member").split(".")
    claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    claims["role"] = "admin"
    forged = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=").decode()
    _assert_rejected(f"{header}.{forged}.{signature}", "invalid_token")


def test_tampered_signature_raises_invalid_token():
    header, payload, signature = auth.make_access_token(42, "member").split(".")
    # Change the first character: the last one can carry only padding bits.
    flipped = ("B" if signature[0] == "A" else "A") + signature[1:]
    _assert_rejected(f"{header}.{payload}.{flipped}", "invalid_token")


def test_hs512_token_is_rejected():
    _assert_rejected(_encode(_claims(), algorithm="HS512"), "invalid_token")


def test_alg_none_token_is_rejected():
    _assert_rejected(jwt.encode(_claims(), None, algorithm="none"), "invalid_token")


def test_refresh_type_token_is_rejected_by_access_decoder():
    _assert_rejected(_encode(_claims(type="refresh")), "invalid_token")


@pytest.mark.parametrize("missing", ["exp", "sub", "type", "iat"])
def test_token_missing_required_claim_is_rejected(missing):
    _assert_rejected(_encode(_claims(drop=(missing,))), "invalid_token")


def test_token_signed_with_different_postgres_pass_is_rejected(monkeypatch, postgres_pass):
    monkeypatch.setenv("POSTGRES_PASS", "a-different-database-password")
    token = auth.make_access_token(1, "admin")
    monkeypatch.setenv("POSTGRES_PASS", postgres_pass)
    _assert_rejected(token, "invalid_token")


@pytest.mark.parametrize("unset", [True, False], ids=["missing", "empty"])
def test_missing_postgres_pass_raises_on_create(monkeypatch, unset):
    if unset:
        monkeypatch.delenv("POSTGRES_PASS")
    else:
        monkeypatch.setenv("POSTGRES_PASS", "")
    with pytest.raises(RuntimeError, match="POSTGRES_PASS"):
        auth.make_access_token(1, "admin")


@pytest.mark.parametrize("unset", [True, False], ids=["missing", "empty"])
def test_missing_postgres_pass_raises_on_decode(monkeypatch, unset):
    token = auth.make_access_token(1, "admin")
    if unset:
        monkeypatch.delenv("POSTGRES_PASS")
    else:
        monkeypatch.setenv("POSTGRES_PASS", "")
    with pytest.raises(RuntimeError, match="POSTGRES_PASS"):
        auth.decode_access_token(token)


@pytest.mark.parametrize("token", [
    pytest.param(None, id="none"),
    pytest.param("", id="empty"),
    pytest.param("garbage", id="garbage"),
    pytest.param("a.b.c", id="three-junk-segments"),
    pytest.param("not.a.jwt.at.all", id="too-many-segments"),
    pytest.param(12345, id="not-a-string"),
    pytest.param(b"\xff\xfe", id="junk-bytes"),
])
def test_garbage_and_none_inputs_raise_invalid_token(token):
    _assert_rejected(token, "invalid_token")


def test_derived_key_is_deterministic_and_not_the_raw_password(postgres_pass):
    first = auth._signing_key()
    assert first == auth._signing_key()
    assert len(first) == 32
    assert first != postgres_pass.encode()
    assert postgres_pass.encode() not in first
    expected = hmac.new(postgres_pass.encode(), b"acme-tracker-jwt-v1", hashlib.sha256).digest()
    assert first == expected


# =====================================================================
# Refresh token helpers
# =====================================================================
def test_generated_refresh_tokens_differ_and_are_long_enough():
    first = auth.generate_refresh_token()
    second = auth.generate_refresh_token()
    assert first != second
    assert len(first) >= 43
    assert len(second) >= 43
    assert "." not in first  # not a JWT


def test_refresh_token_hash_is_sha256_hex_and_never_the_raw_token():
    token = auth.generate_refresh_token()
    digest = auth.hash_refresh_token(token)
    assert len(digest) == 64
    assert all(c in "0123456789abcdef" for c in digest)
    assert digest == auth.hash_refresh_token(token)
    assert digest != auth.hash_refresh_token(auth.generate_refresh_token())
    assert digest != token
    assert digest == hashlib.sha256(token.encode("utf-8")).hexdigest()
