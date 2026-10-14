"""POST /, PUT /{id} and POST /{id}/archive: admin-only changes, validation,
audit without values, and the archive / last-admin safety rules."""

import json
import uuid

import pytest

from common import auth
from common.errors import Forbidden

pytestmark = pytest.mark.integration

LIST = "/api/employees/"
NEW_PASSWORD = "Initial-Pass-2024"


def _one(path_id):
    return f"/api/employees/{path_id}"


def _new(**overrides):
    body = {"name": "Nia New", "email": "nia@acme.test", "job_title": "Analyst",
            "role": "employee", "salary": 70000.5, "password": NEW_PASSWORD}
    body.update(overrides)
    return body


def rbac_row(employee):
    """The actor dict that rbac.authenticate_request would have returned earlier."""
    return {k: employee[k] for k in ("id", "email", "name", "role", "job_title")}


def _count(db, sql, params=()):
    return db.query_one(f"SELECT count(*) AS n FROM ({sql}) AS q", params)["n"]


# =====================================================================
# POST / (create)
# =====================================================================
def test_admin_creates_an_employee(api, staff, token_for, migrated_db, audit_rows):
    resp = api("POST", LIST, token=token_for(staff["admin"]), body=_new())
    assert resp.status == 201
    created = resp.json
    assert {k: created[k] for k in ("name", "email", "job_title", "role", "salary")} == {
        "name": "Nia New", "email": "nia@acme.test", "job_title": "Analyst",
        "role": "employee", "salary": 70000.5}
    assert created["archived_at"] is None
    assert NEW_PASSWORD not in resp.text

    stored = migrated_db.query_one("SELECT password_hash FROM employees WHERE id = %s",
                                   (created["id"],))
    assert stored["password_hash"] != NEW_PASSWORD
    assert auth.verify_password(NEW_PASSWORD, stored["password_hash"])

    rows = audit_rows()
    assert [(r["action"], str(r["actor_id"]), str(r["entity_id"]), r["details"]) for r in rows] == [
        ("employee_created", str(staff["admin"]["id"]), created["id"], None)]


@pytest.mark.parametrize("who", ["manager", "employee"])
def test_non_admin_cannot_create(api, staff, token_for, migrated_db, who):
    resp = api("POST", LIST, token=token_for(staff[who]), body=_new())
    assert resp.status == 403
    assert _count(migrated_db, "SELECT 1 FROM employees WHERE email = %s", ("nia@acme.test",)) == 0


def test_create_without_a_token_is_401(api, staff):
    assert api("POST", LIST, body=_new()).status == 401


def test_duplicate_email_in_any_case_is_409(api, staff, token_for):
    resp = api("POST", LIST, token=token_for(staff["admin"]), body=_new(email="EVE@acme.TEST"))
    assert resp.status == 409
    assert resp.json["error"]["code"] == "email_taken"


@pytest.mark.parametrize("field", ["name", "email", "job_title", "role", "salary", "password"])
def test_every_field_is_required(api, staff, token_for, field):
    body = _new()
    del body[field]
    resp = api("POST", LIST, token=token_for(staff["admin"]), body=body)
    assert resp.status == 400
    assert field in resp.json["error"]["message"]


@pytest.mark.parametrize("overrides", [
    pytest.param({"email": "not-an-email"}, id="bad-email"),
    pytest.param({"name": "   "}, id="blank-name"),
    pytest.param({"name": "x" * 201}, id="long-name"),
    pytest.param({"job_title": 7}, id="job-title-not-string"),
    pytest.param({"role": "superuser"}, id="unknown-role"),
    pytest.param({"role": "Admin"}, id="role-wrong-case"),
    pytest.param({"salary": -1}, id="negative-salary"),
    pytest.param({"salary": 10_000_000_000}, id="salary-too-big"),
    pytest.param({"salary": 1.005}, id="salary-three-decimals"),
    pytest.param({"salary": "50000"}, id="salary-as-string"),
    pytest.param({"salary": True}, id="salary-as-bool"),
    pytest.param({"salary": None}, id="salary-null"),
    pytest.param({"password": "short-pw"}, id="password-too-short"),
    pytest.param({"password": "x" * 257}, id="password-too-long"),
    pytest.param({"password_hash": "scrypt$fake"}, id="unknown-field"),
])
def test_invalid_input_is_400_and_creates_nothing(api, staff, token_for, migrated_db, overrides):
    resp = api("POST", LIST, token=token_for(staff["admin"]), body=_new(**overrides))
    assert resp.status == 400, resp.text
    assert resp.json["error"]["code"] == "bad_request"
    assert _count(migrated_db, "SELECT 1 FROM employees") == 3


def test_non_finite_salary_is_400(api, staff, token_for):
    # json.dumps writes NaN, which Python's json.loads accepts; the API must not.
    raw = json.dumps(_new(salary=float("nan")))
    resp = api("POST", LIST, token=token_for(staff["admin"]), raw_body=raw)
    assert resp.status == 400


@pytest.mark.parametrize("body", [[], "text", 5])
def test_body_must_be_an_object(api, staff, token_for, body):
    assert api("POST", LIST, token=token_for(staff["admin"]), body=body).status == 400


def test_whole_number_and_zero_salaries_are_accepted(api, staff, token_for):
    resp = api("POST", LIST, token=token_for(staff["admin"]), body=_new(salary=0))
    assert resp.status == 201 and resp.json["salary"] == 0


# =====================================================================
# PUT /{id} (update)
# =====================================================================
def test_admin_updates_name_and_job_title(api, staff, token_for, audit_rows):
    target = staff["employee"]
    resp = api("PUT", _one(target["id"]), token=token_for(staff["admin"]),
               body={"name": "Eve Senior", "job_title": "Senior Engineer"})
    assert resp.status == 200
    assert resp.json["name"] == "Eve Senior" and resp.json["job_title"] == "Senior Engineer"
    rows = audit_rows()
    assert [(r["action"], r["details"]) for r in rows] == [
        ("employee_updated", {"fields": ["job_title", "name"]})]


def test_role_and_salary_changes_are_audited_without_values(api, staff, token_for, audit_rows):
    target = staff["employee"]
    resp = api("PUT", _one(target["id"]), token=token_for(staff["admin"]),
               body={"role": "manager", "salary": 99999.99})
    assert resp.status == 200
    assert resp.json["role"] == "manager" and resp.json["salary"] == 99999.99

    rows = audit_rows()
    assert sorted(r["action"] for r in rows) == ["employee_role_changed", "employee_salary_changed"]
    for row in rows:
        # details is the only free-form column, so no old or new value is stored.
        assert row["details"] is None
        assert str(row["entity_id"]) == str(target["id"])
        assert str(row["actor_id"]) == str(staff["admin"]["id"])


def test_unchanged_values_write_no_audit_rows(api, staff, token_for, audit_rows):
    target = staff["employee"]
    resp = api("PUT", _one(target["id"]), token=token_for(staff["admin"]),
               body={"name": "Eve Employee", "role": "employee", "salary": 90000})
    assert resp.status == 200
    assert audit_rows() == []


@pytest.mark.parametrize("who", ["manager", "employee"])
def test_non_admin_cannot_update(api, staff, token_for, migrated_db, who):
    resp = api("PUT", _one(staff["employee"]["id"]), token=token_for(staff[who]),
               body={"salary": 1})
    assert resp.status == 403
    row = migrated_db.query_one("SELECT salary FROM employees WHERE id = %s",
                                (str(staff["employee"]["id"]),))
    assert row["salary"] == 90000


@pytest.mark.parametrize("body", [
    pytest.param({}, id="empty"),
    pytest.param({"email": "new@acme.test"}, id="email-not-updatable"),
    pytest.param({"password": NEW_PASSWORD}, id="password-not-updatable"),
    pytest.param({"name": None}, id="null-name"),
    pytest.param({"role": "owner"}, id="bad-role"),
    pytest.param({"salary": -5}, id="bad-salary"),
])
def test_invalid_update_is_400(api, staff, token_for, body):
    resp = api("PUT", _one(staff["employee"]["id"]), token=token_for(staff["admin"]), body=body)
    assert resp.status == 400


def test_update_unknown_or_malformed_id_is_404(api, staff, token_for):
    admin = token_for(staff["admin"])
    assert api("PUT", _one(uuid.uuid4()), token=admin, body={"name": "X"}).status == 404
    assert api("PUT", _one("nope"), token=admin, body={"name": "X"}).status == 404


def test_archived_employee_cannot_be_updated(api, staff, make_employee, token_for):
    old = make_employee(email="old@acme.test", archived=True)
    resp = api("PUT", _one(old["id"]), token=token_for(staff["admin"]), body={"name": "X"})
    assert resp.status == 409 and resp.json["error"]["code"] == "archived"


def test_last_admin_cannot_demote_themselves(api, staff, token_for):
    admin = staff["admin"]
    resp = api("PUT", _one(admin["id"]), token=token_for(admin), body={"role": "manager"})
    assert resp.status == 409 and resp.json["error"]["code"] == "last_admin"


def test_an_admin_can_be_demoted_while_another_admin_remains(api, staff, make_employee, token_for):
    second = make_employee(email="bo@acme.test", role="admin")
    resp = api("PUT", _one(second["id"]), token=token_for(staff["admin"]), body={"role": "employee"})
    assert resp.status == 200 and resp.json["role"] == "employee"


def test_update_rechecks_the_actor_is_still_an_admin(svc, staff, migrated_db):
    # The actor row was loaded before the transaction; if they were demoted in
    # between, the locked re-check refuses.
    stale_actor = dict(rbac_row(staff["manager"]), role="admin")
    with pytest.raises(Forbidden):
        svc.services.update_employee(stale_actor, str(staff["employee"]["id"]), {"name": "X"})


# =====================================================================
# POST /{id}/archive
# =====================================================================
def test_admin_archives_an_employee(api, staff, token_for, migrated_db, audit_rows):
    target = staff["employee"]
    resp = api("POST", _one(target["id"]) + "/archive", token=token_for(staff["admin"]))
    assert resp.status == 200 and resp.json["archived_at"] is not None

    # Archived, never deleted.
    assert _count(migrated_db, "SELECT 1 FROM employees WHERE id = %s", (str(target["id"]),)) == 1
    listed = api("GET", LIST, token=token_for(staff["admin"])).json["employees"]
    assert str(target["id"]) not in {e["id"] for e in listed}
    assert [(r["action"], r["details"]) for r in audit_rows()] == [("employee_archived", None)]
    # Their existing token stops working at once.
    assert api("GET", _one(target["id"]), token=token_for(target)).status == 401


def test_admin_cannot_archive_themselves(api, staff, token_for):
    admin = staff["admin"]
    resp = api("POST", _one(admin["id"]) + "/archive", token=token_for(admin))
    assert resp.status == 409 and resp.json["error"]["code"] == "cannot_archive_self"


def test_archiving_twice_is_409(api, staff, token_for):
    path = _one(staff["employee"]["id"]) + "/archive"
    token = token_for(staff["admin"])
    assert api("POST", path, token=token).status == 200
    resp = api("POST", path, token=token)
    assert resp.status == 409 and resp.json["error"]["code"] == "already_archived"


@pytest.mark.parametrize("who", ["manager", "employee"])
def test_non_admin_cannot_archive(api, staff, token_for, who):
    resp = api("POST", _one(staff["employee"]["id"]) + "/archive", token=token_for(staff[who]))
    assert resp.status == 403


def test_archive_unknown_or_malformed_id_is_404(api, staff, token_for):
    admin = token_for(staff["admin"])
    assert api("POST", _one(uuid.uuid4()) + "/archive", token=admin).status == 404
    assert api("POST", _one("nope") + "/archive", token=admin).status == 404


def test_the_last_active_admin_can_never_be_archived(api, svc, staff, make_employee,
                                                     token_for, migrated_db):
    # Two admins try to archive each other. The first wins; the second request
    # was authenticated before that, but the locked re-check refuses it.
    a, b = staff["admin"], make_employee(email="bo@acme.test", role="admin")
    stale_b = rbac_row(b)
    assert api("POST", _one(b["id"]) + "/archive", token=token_for(a)).status == 200
    with pytest.raises(Forbidden):
        svc.services.archive_employee(stale_b, str(a["id"]))

    # A is now the only active admin, and nobody can archive A: A cannot archive
    # themselves, and only an admin may archive.
    assert api("POST", _one(a["id"]) + "/archive", token=token_for(a)).status == 409
    assert api("POST", _one(a["id"]) + "/archive", token=token_for(staff["manager"])).status == 403
    active_admins = _count(migrated_db, "SELECT 1 FROM employees "
                                        "WHERE role = 'admin' AND archived_at IS NULL")
    assert active_admins == 1


# =====================================================================
# Team leads (docs/api-contract.md section 2)
# =====================================================================
def _lead_a_team(db, lead, archived=False):
    db.execute("INSERT INTO teams (name, lead_id, archived_at) "
               "VALUES ('Platform', %s, CASE WHEN %s THEN now() END)", (str(lead["id"]), archived))


def test_a_team_lead_cannot_be_demoted_to_employee(api, staff, token_for, migrated_db):
    _lead_a_team(migrated_db, staff["manager"])
    resp = api("PUT", _one(staff["manager"]["id"]), token=token_for(staff["admin"]),
               body={"role": "employee"})
    assert resp.status == 409 and resp.json["error"]["code"] == "leads_team"
    row = migrated_db.query_one("SELECT role FROM employees WHERE id = %s", (str(staff["manager"]["id"]),))
    assert row["role"] == "manager"


def test_a_team_lead_can_still_change_between_manager_and_admin(api, staff, token_for, migrated_db):
    _lead_a_team(migrated_db, staff["manager"])
    resp = api("PUT", _one(staff["manager"]["id"]), token=token_for(staff["admin"]),
               body={"role": "admin", "name": "Max M"})
    assert resp.status == 200 and resp.json["role"] == "admin"


def test_a_team_lead_cannot_be_archived(api, staff, token_for):
    from common import db
    _lead_a_team(db, staff["manager"])
    resp = api("POST", _one(staff["manager"]["id"]) + "/archive", token=token_for(staff["admin"]))
    assert resp.status == 409 and resp.json["error"]["code"] == "leads_team"


def test_leading_only_an_archived_team_does_not_block(api, staff, token_for, migrated_db):
    _lead_a_team(migrated_db, staff["manager"], archived=True)
    token = token_for(staff["admin"])
    assert api("PUT", _one(staff["manager"]["id"]), token=token, body={"role": "employee"}).status == 200
    assert api("POST", _one(staff["manager"]["id"]) + "/archive", token=token).status == 200
