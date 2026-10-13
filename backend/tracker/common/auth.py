"""Password hashing (scrypt) and JWT tokens (HS256).

Passwords:
- hashlib.scrypt with N=2^14, r=8, p=1, maxmem=64 MiB, a random 16-byte salt.
- The parameters and salt are stored *inside* the hash string, so verification
  uses the stored parameters:  scrypt$N$r$p$<salt_b64>$<dk_b64>
- Verification is constant-time (hmac.compare_digest). No rehash feature.

Tokens:
- PyJWT, HS256 only. Decoding rejects any other algorithm.
- Access token 15 min, refresh token 7 days.
- Claims: sub (user id), role, type ("access"/"refresh"), iat, exp.
- Never include salary or email.
- Signing key is derived with HMAC-SHA256 from POSTGRES_PASS plus a fixed app
  label. If POSTGRES_PASS is empty we refuse to run rather than sign with a
  weak key.
"""

import base64
import datetime
import hashlib
import hmac
import os

import jwt

from common.errors import Unauthorized

# --- scrypt parameters ---
_SCRYPT_N = 2 ** 14          # 16384
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_MAXMEM = 64 * 1024 * 1024   # 64 MiB (requirement is 128*N*r = 16 MiB)
_SCRYPT_DKLEN = 32
_SALT_BYTES = 16

# A fixed, valid hash used to spend the same work when an account does not
# exist or is locked, so login timing does not reveal which case occurred.
DUMMY_PASSWORD_HASH = (
    "scrypt$16384$8$1$mp30tJkoofwz8JhYsAgtcg==$SOd8WW3xfGR31PIkRSrXNzZo9AOMllLCvm3Q1mTMutU="
)

# --- JWT configuration ---
_ALGORITHM = "HS256"
_APP_LABEL = b"acme-tracker-jwt-v1"
ACCESS_TTL = datetime.timedelta(minutes=15)
REFRESH_TTL = datetime.timedelta(days=7)
TYPE_ACCESS = "access"
TYPE_REFRESH = "refresh"


# =====================================================================
# Password hashing
# =====================================================================
def hash_password(password: str) -> str:
    salt = os.urandom(_SALT_BYTES)
    dk = hashlib.scrypt(
        password.encode("utf-8"), salt=salt,
        n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P,
        maxmem=_SCRYPT_MAXMEM, dklen=_SCRYPT_DKLEN,
    )
    return "scrypt${}${}${}${}${}".format(
        _SCRYPT_N, _SCRYPT_R, _SCRYPT_P,
        base64.b64encode(salt).decode(), base64.b64encode(dk).decode(),
    )


def verify_password(password: str, stored: str) -> bool:
    """Constant-time verify using the parameters stored in `stored`."""
    try:
        scheme, n_s, r_s, p_s, salt_b64, dk_b64 = stored.split("$")
        if scheme != "scrypt":
            return False
        n, r, p = int(n_s), int(r_s), int(p_s)
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(dk_b64)
    except (ValueError, TypeError):
        return False

    actual = hashlib.scrypt(
        password.encode("utf-8"), salt=salt,
        n=n, r=r, p=p, maxmem=_SCRYPT_MAXMEM, dklen=len(expected),
    )
    return hmac.compare_digest(actual, expected)


def dummy_verify():
    """Spend one scrypt verification against the dummy hash (timing cover)."""
    verify_password("timing-cover-password", DUMMY_PASSWORD_HASH)


# =====================================================================
# JWT tokens
# =====================================================================
def _signing_key() -> bytes:
    db_pass = os.getenv("POSTGRES_PASS", "")
    if not db_pass:
        # Refuse to run with a weak/absent key.
        raise RuntimeError("POSTGRES_PASS is not set; cannot derive JWT signing key.")
    return hmac.new(db_pass.encode("utf-8"), _APP_LABEL, hashlib.sha256).digest()


def _make_token(user_id, role, token_type, ttl):
    now = datetime.datetime.now(datetime.timezone.utc)
    claims = {
        "sub": str(user_id),
        "role": role,
        "type": token_type,
        "iat": int(now.timestamp()),
        "exp": int((now + ttl).timestamp()),
    }
    return jwt.encode(claims, _signing_key(), algorithm=_ALGORITHM)


def make_access_token(user_id, role):
    return _make_token(user_id, role, TYPE_ACCESS, ACCESS_TTL)


def make_refresh_token(user_id, role):
    return _make_token(user_id, role, TYPE_REFRESH, REFRESH_TTL)


def decode_token(token, expected_type=None):
    """Decode and validate a token. Raises Unauthorized on any problem.

    Only HS256 is accepted; a token signed with any other algorithm (or 'none')
    is rejected.
    """
    try:
        claims = jwt.decode(
            token, _signing_key(),
            algorithms=[_ALGORITHM],
            options={"require": ["exp", "iat", "sub", "type"]},
        )
    except jwt.ExpiredSignatureError:
        raise Unauthorized("Token has expired.", code="token_expired")
    except jwt.InvalidTokenError:
        raise Unauthorized("Invalid token.", code="invalid_token")

    if expected_type is not None and claims.get("type") != expected_type:
        raise Unauthorized("Wrong token type.", code="wrong_token_type")

    return claims
