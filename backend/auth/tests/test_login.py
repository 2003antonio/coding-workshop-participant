"""Login: success, every failure kind, lockout, timing cover, concurrency, audit."""

import threading

import pytest

from common import auth, db

pytestmark = pytest.mark.integration

_SENSITIVE = ("password_hash", "salary", "failed_attempts", "locked_until")
_GENERIC_401 = {"error": {"code": "invalid_credentials", "message": "Invalid email or password."}}


def _login(api, email, password):
    return api("POST", "/api/auth/login", body={"email": email, "password": password})


def _employee_state(employee_id):
    return db.query_one(
        "SELECT failed_attempts, locked_until FROM employees WHERE id = %s", (str(employee_id),)
    )


def _audit_actions(employee_id=None):
    if employee_id is None:
        rows = db.query("SELECT action FROM audit_log ORDER BY created_at")
    else:
        rows = db.query("SELECT action FROM audit_log WHERE actor_id = %s ORDER BY created_at",
                        (str(employee_id),))
    return [r["action"] for r in rows]


# =====================================================================
# Success and failures
# =====================================================================
def test_login_success_returns_tokens_and_public_user(api, make_employee):
    emp = make_employee(role="manager")
    resp = _login(api, emp["email"], emp["password"])
    assert resp.status == 200
    body = resp.json
    assert set(body) == {"access_token", "refresh_token", "user"}
    assert body["user"] == {"id": str(emp["id"]), "email": emp["email"],
                            "name": emp["name"], "role": "manager"}
    claims = auth.decode_access_token(body["access_token"])
    assert claims["sub"] == str(emp["id"]) and claims["role"] == "manager"
    assert "." not in body["refresh_token"]  # opaque, not a JWT
    stored = db.query_one("SELECT token_hash FROM refresh_tokens")
    assert stored["token_hash"] == auth.hash_refresh_token(body["refresh_token"])
    for word in _SENSITIVE:
        assert word not in resp.text


def test_login_email_is_case_insensitive(api, make_employee):
    emp = make_employee(email="Ana@Acme.test")
    assert _login(api, "ana@ACME.TEST", emp["password"]).status == 200


def test_wrong_password_unknown_archived_and_locked_all_look_the_same(api, make_employee):
    good = make_employee(email="good@acme.test")
    archived = make_employee(email="gone@acme.test", archived=True)
    locked = make_employee(email="locked@acme.test")
    db.execute("UPDATE employees SET locked_until = now() + interval '10 minutes' WHERE id = %s",
               (str(locked["id"]),))

    responses = [
        _login(api, good["email"], "wrong-password"),
        _login(api, "nobody@acme.test", "whatever-password"),
        _login(api, archived["email"], archived["password"]),
        _login(api, locked["email"], locked["password"]),
    ]
    for resp in responses:
        assert resp.status == 401
        assert resp.json == _GENERIC_401
    assert len({r.text for r in responses}) == 1


def test_success_resets_the_failed_counter(api, make_employee):
    emp = make_employee()
    for _ in range(3):
        _login(api, emp["email"], "wrong-password")
    assert _employee_state(emp["id"])["failed_attempts"] == 3
    assert _login(api, emp["email"], emp["password"]).status == 200
    assert _employee_state(emp["id"]) == {"failed_attempts": 0, "locked_until": None}


# =====================================================================
# Lockout
# =====================================================================
def test_lockout_after_five_failures_blocks_even_the_right_password(api, make_employee):
    emp = make_employee()
    for _ in range(4):
        _login(api, emp["email"], "wrong-password")
    assert _employee_state(emp["id"])["locked_until"] is None
    _login(api, emp["email"], "wrong-password")
    state = _employee_state(emp["id"])
    assert state["failed_attempts"] == 5 and state["locked_until"] is not None

    resp = _login(api, emp["email"], emp["password"])
    assert resp.status == 401 and resp.json == _GENERIC_401
    assert _audit_actions(emp["id"])[-1] == "login_locked"


def test_failure_after_an_expired_lock_restarts_the_count_at_one(api, make_employee):
    emp = make_employee()
    db.execute("UPDATE employees SET failed_attempts = 5, "
               "locked_until = now() - interval '1 minute' WHERE id = %s", (str(emp["id"]),))
    _login(api, emp["email"], "wrong-password")
    assert _employee_state(emp["id"]) == {"failed_attempts": 1, "locked_until": None}


def test_right_password_after_an_expired_lock_succeeds(api, make_employee):
    emp = make_employee()
    db.execute("UPDATE employees SET failed_attempts = 5, "
               "locked_until = now() - interval '1 minute' WHERE id = %s", (str(emp["id"]),))
    assert _login(api, emp["email"], emp["password"]).status == 200
    assert _employee_state(emp["id"]) == {"failed_attempts": 0, "locked_until": None}


def test_ten_concurrent_wrong_attempts_leave_the_counter_correct(make_employee, lambda_event):
    import function

    emp = make_employee()
    event = lambda_event("POST", "/api/auth/login",
                       body={"email": emp["email"], "password": "wrong-password"})
    barrier = threading.Barrier(10)
    statuses = []

    def attempt():
        try:
            barrier.wait()
            statuses.append(function.handler(dict(event), None)["statusCode"])
        finally:
            db.close()

    threads = [threading.Thread(target=attempt) for _ in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)

    assert statuses == [401] * 10
    state = _employee_state(emp["id"])
    actions = _audit_actions(emp["id"])
    wrong_password_attempts = actions.count("login_failure")
    # No lost updates: one increment per attempt that reached the password check.
    assert state["failed_attempts"] == wrong_password_attempts
    assert wrong_password_attempts + actions.count("login_locked") == 10
    assert state["failed_attempts"] >= 5
    assert state["locked_until"] is not None


# =====================================================================
# Timing cover: exactly one scrypt per attempt on every path
# =====================================================================
@pytest.mark.parametrize("case", ["success", "wrong_password", "unknown_email", "archived", "locked"])
def test_exactly_one_scrypt_per_login_attempt(api, make_employee, scrypt_calls, case):
    emp = make_employee(archived=(case == "archived"))
    if case == "locked":
        db.execute("UPDATE employees SET locked_until = now() + interval '10 minutes' "
                   "WHERE id = %s", (str(emp["id"]),))
    email = "nobody@acme.test" if case == "unknown_email" else emp["email"]
    password = "wrong-password" if case == "wrong_password" else emp["password"]

    calls = scrypt_calls()
    resp = _login(api, email, password)
    assert resp.status == (200 if case == "success" else 401)
    assert len(calls) == 1


# =====================================================================
# Audit
# =====================================================================
def test_login_outcomes_are_audited_without_secrets(api, make_employee):
    emp = make_employee()
    _login(api, emp["email"], emp["password"])
    _login(api, emp["email"], "wrong-password")
    _login(api, "nobody@acme.test", "wrong-password")
    db.execute("UPDATE employees SET locked_until = now() + interval '5 minutes' WHERE id = %s",
               (str(emp["id"]),))
    _login(api, emp["email"], emp["password"])

    assert _audit_actions() == ["login_success", "login_failure", "login_failure", "login_locked"]
    details = db.query("SELECT details::text AS d FROM audit_log")
    dump = " ".join(r["d"] or "" for r in details)
    assert emp["password"] not in dump and "wrong-password" not in dump
    assert emp["email"] not in dump and "nobody@acme.test" not in dump


# =====================================================================
# Input validation (400, before any lookup or scrypt)
# =====================================================================
@pytest.mark.parametrize("body", [
    pytest.param({"password": "x"}, id="missing-email"),
    pytest.param({"email": "ana@acme.test"}, id="missing-password"),
    pytest.param({"email": 5, "password": "x"}, id="email-not-string"),
    pytest.param({"email": "ana@acme.test", "password": 5}, id="password-not-string"),
    pytest.param({"email": "not-an-email", "password": "x"}, id="bad-email-format"),
    pytest.param({"email": "a" * 250 + "@acme.test", "password": "x"}, id="email-too-long"),
    pytest.param({"email": "ana@acme.test", "password": "x" * 257}, id="password-too-long"),
    pytest.param({"email": "ana@acme.test", "password": ""}, id="password-empty"),
    pytest.param(["not", "an", "object"], id="not-an-object"),
])
def test_invalid_login_input_is_400_without_scrypt(api, scrypt_calls, body):
    calls = scrypt_calls()
    resp = api("POST", "/api/auth/login", body=body)
    assert resp.status == 400
    assert resp.json["error"]["code"] == "bad_request"
    assert calls == []


def test_password_is_not_trimmed(api, make_employee):
    emp = make_employee(password="secret-pass")
    assert _login(api, emp["email"], " secret-pass ").status == 401
