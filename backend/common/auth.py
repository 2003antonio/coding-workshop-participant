"""Password hashing (scrypt), access tokens (JWT, HS256) and refresh token helpers.

Passwords:
- hashlib.scrypt with N=2^14, r=8, p=1, maxmem=64 MiB, a random 16-byte salt.
- The parameters and salt are stored *inside* the hash string, so verification
  uses the stored parameters:  scrypt$N$r$p$<salt_b64>$<dk_b64>
- Verification is constant-time (hmac.compare_digest). No rehash feature.
- Stored parameters above N=2^16, r=16, p=16 are refused, and a malformed hash
  string verifies as False instead of raising.
- Passwords must be 1 to 256 characters.

Access tokens:
- PyJWT, HS256 only. Decoding rejects any other algorithm.
- Access token 15 min. Claims: sub (user id), role, type ("access"), iat, exp.
- Never include salary or email.
- Signing key is derived with HMAC-SHA256 from POSTGRES_PASS plus a fixed app
  label, read at call time. If POSTGRES_PASS is empty we refuse to run rather
  than sign with a weak key.

Refresh tokens:
- Random strings, not JWTs. Only their SHA-256 hash is ever stored.
"""

import base64
import datetime
import hashlib
import hmac
import os
import secrets

import jwt

from common.errors import Unauthorized

# --- scrypt parameters ---
_SCRYPT_N = 2 ** 14          # 16384
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_MAXMEM = 64 * 1024 * 1024   # 64 MiB (requirement is 128*N*r = 16 MiB)
_SCRYPT_DKLEN = 32
_SALT_BYTES = 16

# Upper bounds for parameters read from a stored hash, so a corrupted hash
# cannot demand huge amounts of memory or CPU.
_MAX_N = 2 ** 16
_MAX_R = 16
_MAX_P = 16

_MAX_PASSWORD_CHARS = 256

# A fixed, valid hash used to spend the same work when an account does not
# exist or is locked, so login timing does not reveal which case occurred.
DUMMY_PASSWORD_HASH = (
    "scrypt$16384$8$1$mp30tJkoofwz8JhYsAgtcg==$SOd8WW3xfGR31PIkRSrXNzZo9AOMllLCvm3Q1mTMutU="
)

# --- JWT configuration ---
_ALGORITHM = "HS256"
_APP_LABEL = b"acme-tracker-jwt-v1"
ACCESS_TTL = datetime.timedelta(minutes=15)
TYPE_ACCESS = "access"

# --- Refresh token configuration ---
_REFRESH_TOKEN_BYTES = 32    # token_urlsafe(32) -> 43 characters


# =====================================================================
# Password hashing
# =====================================================================
def _is_acceptable_password(password: object) -> bool:
    """Return True if password is a non-empty string of at most 256 characters."""
    return isinstance(password, str) and 0 < len(password) <= _MAX_PASSWORD_CHARS


def hash_password(password: str) -> str:
    """Hash a password with scrypt and a fresh random salt.

    Args:
        password: Plain-text password, 1 to 256 characters.

    Returns:
        Hash string in the form scrypt$N$r$p$<salt_b64>$<dk_b64>.

    Raises:
        ValueError: If the password is empty, None, or longer than 256 characters.
    """
    if not _is_acceptable_password(password):
        raise ValueError("Password must be 1 to 256 characters.")
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
    """Constant-time verify using the parameters stored in `stored`.

    Args:
        password: Plain-text password to check.
        stored: Hash string produced by hash_password.

    Returns:
        True only if the password matches. False for a wrong password, an
        unacceptable password, or a malformed or over-limit hash; never raises.
    """
    if not _is_acceptable_password(password) or not isinstance(stored, str):
        return False
    try:
        scheme, n_s, r_s, p_s, salt_b64, dk_b64 = stored.split("$")
        if scheme != "scrypt":
            return False
        n, r, p = int(n_s), int(r_s), int(p_s)
        if not (1 < n <= _MAX_N and 1 <= r <= _MAX_R and 1 <= p <= _MAX_P):
            return False
        salt = base64.b64decode(salt_b64, validate=True)
        expected = base64.b64decode(dk_b64, validate=True)
        if not salt or not expected:
            return False
        actual = hashlib.scrypt(
            password.encode("utf-8"), salt=salt,
            n=n, r=r, p=p, maxmem=_SCRYPT_MAXMEM, dklen=len(expected),
        )
    except (ValueError, TypeError, OverflowError, MemoryError):
        return False
    return hmac.compare_digest(actual, expected)


def dummy_verify() -> bool:
    """Spend one scrypt verification against the dummy hash (timing cover).

    Returns:
        Always False, so it can never let a login through.
    """
    verify_password("timing-cover-password", DUMMY_PASSWORD_HASH)
    return False


# =====================================================================
# Access tokens (JWT)
# =====================================================================
def _signing_key() -> bytes:
    """Derive the JWT signing key from POSTGRES_PASS, read at call time.

    Raises:
        RuntimeError: If POSTGRES_PASS is missing or empty.
    """
    db_pass = os.getenv("POSTGRES_PASS", "")
    if not db_pass:
        # Refuse to run with a weak/absent key.
        raise RuntimeError("POSTGRES_PASS is not set; cannot derive JWT signing key.")
    return hmac.new(db_pass.encode("utf-8"), _APP_LABEL, hashlib.sha256).digest()


def make_access_token(user_id: object, role: str) -> str:
    """Create a signed 15-minute access token.

    Args:
        user_id: The user's id; stored as a string in the `sub` claim.
        role: The user's role name.

    Returns:
        Encoded JWT string with claims sub, role, type, iat, exp.
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    claims = {
        "sub": str(user_id),
        "role": role,
        "type": TYPE_ACCESS,
        "iat": int(now.timestamp()),
        "exp": int((now + ACCESS_TTL).timestamp()),
    }
    return jwt.encode(claims, _signing_key(), algorithm=_ALGORITHM)


def decode_access_token(token: str) -> dict:
    """Decode and validate an access token.

    Only HS256 is accepted; a token signed with any other algorithm (or 'none')
    is rejected, as is any token whose type is not "access".

    Args:
        token: Encoded JWT string.

    Returns:
        The validated claims.

    Raises:
        Unauthorized: code "token_expired" if expired, "invalid_token" otherwise.
        RuntimeError: If POSTGRES_PASS is missing or empty.
    """
    key = _signing_key()
    try:
        claims = jwt.decode(
            token, key,
            algorithms=[_ALGORITHM],
            options={"require": ["exp", "iat", "sub", "type"]},
        )
    except jwt.ExpiredSignatureError:
        raise Unauthorized("Token has expired.", code="token_expired") from None
    except jwt.InvalidTokenError:
        raise Unauthorized("Invalid token.", code="invalid_token") from None

    if claims.get("type") != TYPE_ACCESS:
        raise Unauthorized("Invalid token.", code="invalid_token")

    return claims


# =====================================================================
# Refresh tokens (random strings, stored hashed)
# =====================================================================
def generate_refresh_token() -> str:
    """Return a new random, URL-safe refresh token (43 characters)."""
    return secrets.token_urlsafe(_REFRESH_TOKEN_BYTES)


def hash_refresh_token(token: str) -> str:
    """Return the SHA-256 hex digest of a refresh token, for storage and lookup."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
