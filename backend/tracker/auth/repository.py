"""Refresh-token data access. Only hashes are stored, never raw tokens.
Parameterized only."""

from common import db


def create(employee_id, token_hash, expires_at):
    row = db.query_one(
        "INSERT INTO refresh_tokens (employee_id, token_hash, expires_at) "
        "VALUES (%s, %s, %s) RETURNING id",
        (employee_id, token_hash, expires_at),
    )
    return row["id"]


def get_by_hash(token_hash):
    return db.query_one(
        "SELECT id, employee_id, expires_at, revoked_at, replaced_by "
        "FROM refresh_tokens WHERE token_hash = %s",
        (token_hash,),
    )


def mark_replaced(token_id, new_id):
    db.execute(
        "UPDATE refresh_tokens SET revoked_at = now(), replaced_by = %s "
        "WHERE id = %s AND revoked_at IS NULL",
        (new_id, token_id),
    )


def revoke(token_id):
    db.execute(
        "UPDATE refresh_tokens SET revoked_at = now() "
        "WHERE id = %s AND revoked_at IS NULL",
        (token_id,),
    )


def revoke_all_active(employee_id):
    db.execute(
        "UPDATE refresh_tokens SET revoked_at = now() "
        "WHERE employee_id = %s AND revoked_at IS NULL",
        (employee_id,),
    )
