"""Refresh rotation, reuse detection, expiry, archived users, and logout."""

import pytest

from common import auth, db

pytestmark = pytest.mark.integration

_INVALID = {"error": {"code": "invalid_token", "message": "Invalid refresh token."}}


def _refresh(api, token):
    return api("POST", "/api/auth/refresh", body={"refresh_token": token})


def _token_row(raw):
    return db.query_one(
        "SELECT id, revoked_at, replaced_by FROM refresh_tokens WHERE token_hash = %s",
        (auth.hash_refresh_token(raw),),
    )


def _active_tokens(employee_id):
    return db.query_one(
        "SELECT count(*) AS n FROM refresh_tokens WHERE employee_id = %s AND revoked_at IS NULL",
        (str(employee_id),),
    )["n"]


def test_refresh_rotates_the_token(api, make_employee, login):
    emp = make_employee(role="manager")
    first = login(emp)["refresh_token"]

    resp = _refresh(api, first)
    assert resp.status == 200
    assert set(resp.json) == {"access_token", "refresh_token"}
    second = resp.json["refresh_token"]
    assert second != first
    assert auth.decode_access_token(resp.json["access_token"])["role"] == "manager"

    old, new = _token_row(first), _token_row(second)
    assert old["revoked_at"] is not None and old["replaced_by"] == new["id"]
    assert new["revoked_at"] is None
    assert _refresh(api, second).status == 200  # the new one works (once)


def test_reusing_an_old_token_revokes_the_whole_chain(api, make_employee, login):
    emp = make_employee()
    first = login(emp)["refresh_token"]
    second = _refresh(api, first).json["refresh_token"]
    other_session = login(emp)["refresh_token"]
    assert _active_tokens(emp["id"]) == 2

    reuse = _refresh(api, first)
    assert reuse.status == 401 and reuse.json == _INVALID
    assert _active_tokens(emp["id"]) == 0
    assert _refresh(api, second).status == 401
    assert _refresh(api, other_session).status == 401
    actions = [r["action"] for r in db.query("SELECT action FROM audit_log")]
    assert "refresh_reuse_detected" in actions


def test_expired_refresh_token_is_rejected(api, make_employee, login):
    emp = make_employee()
    raw = login(emp)["refresh_token"]
    db.execute("UPDATE refresh_tokens SET expires_at = now() - interval '1 second'")
    resp = _refresh(api, raw)
    assert resp.status == 401 and resp.json == _INVALID
    # An expired token is just refused; retrying it is not treated as theft.
    assert _refresh(api, raw).status == 401
    assert "refresh_reuse_detected" not in [r["action"] for r in db.query("SELECT action FROM audit_log")]


def test_archived_users_refresh_is_rejected(api, make_employee, login):
    emp = make_employee()
    raw = login(emp)["refresh_token"]
    db.execute("UPDATE employees SET archived_at = now() WHERE id = %s", (str(emp["id"]),))
    resp = _refresh(api, raw)
    assert resp.status == 401 and resp.json == _INVALID


@pytest.mark.parametrize("token", ["never-issued-token", "x" * 43])
def test_unknown_refresh_token_is_rejected(api, token):
    resp = _refresh(api, token)
    assert resp.status == 401 and resp.json == _INVALID


def test_refresh_response_contains_no_sensitive_fields(api, make_employee, login):
    emp = make_employee()
    resp = _refresh(api, login(emp)["refresh_token"])
    for word in ("password_hash", "salary", "failed_attempts", "locked_until"):
        assert word not in resp.text


def test_logout_revokes_the_token_and_returns_204(api, make_employee, login):
    emp = make_employee()
    raw = login(emp)["refresh_token"]
    resp = api("POST", "/api/auth/logout", body={"refresh_token": raw})
    assert resp.status == 204 and resp.text == ""
    assert _token_row(raw)["revoked_at"] is not None
    assert _refresh(api, raw).status == 401
    assert "logout" in [r["action"] for r in db.query("SELECT action FROM audit_log")]


def test_logout_with_unknown_token_still_returns_204(api):
    resp = api("POST", "/api/auth/logout", body={"refresh_token": "never-issued-token"})
    assert resp.status == 204


def test_logout_requires_a_token(api):
    resp = api("POST", "/api/auth/logout", body={})
    assert resp.status == 400
