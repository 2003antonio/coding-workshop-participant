"""GET /api/employees/ and GET /api/employees/{id}: who sees which records and fields."""

import uuid

import pytest

pytestmark = pytest.mark.integration

LIST = "/api/employees/"
BASE_KEYS = {"id", "name", "email", "job_title", "role"}
ADMIN_KEYS = BASE_KEYS | {"salary", "archived_at"}
NEVER_RETURNED = ("password_hash", "failed_attempts", "locked_until", "password")


def _one(path_id):
    return f"/api/employees/{path_id}"


# =====================================================================
# GET / (list)
# =====================================================================
def test_admin_list_includes_salary_sorted_by_name(api, staff, token_for):
    resp = api("GET", LIST, token=token_for(staff["admin"]))
    assert resp.status == 200
    rows = resp.json["employees"]
    assert [r["name"] for r in rows] == ["Ada Admin", "Eve Employee", "Max Manager"]
    assert all(set(r) == ADMIN_KEYS for r in rows)
    salaries = {r["email"]: r["salary"] for r in rows}
    assert salaries == {"ada@acme.test": 150000, "eve@acme.test": 90000, "max@acme.test": 120000}


def test_manager_list_never_contains_salary(api, staff, token_for):
    resp = api("GET", LIST, token=token_for(staff["manager"]))
    assert resp.status == 200
    assert all(set(r) == BASE_KEYS for r in resp.json["employees"])
    assert "salary" not in resp.text
    for amount in ("150000", "120000", "90000"):
        assert amount not in resp.text


def test_employee_cannot_list(api, staff, token_for):
    resp = api("GET", LIST, token=token_for(staff["employee"]))
    assert resp.status == 403
    assert resp.json["error"]["code"] == "forbidden"


def test_list_without_a_token_is_401(api, staff):
    assert api("GET", LIST).status == 401


def test_archived_employees_are_hidden_by_default(api, staff, make_employee, token_for):
    make_employee(email="old@acme.test", name="Old Timer", archived=True)
    for who in ("admin", "manager"):
        resp = api("GET", LIST, token=token_for(staff[who]))
        assert "old@acme.test" not in resp.text


def test_admin_can_include_archived(api, staff, make_employee, token_for):
    make_employee(email="old@acme.test", name="Old Timer", archived=True)
    resp = api("GET", LIST, token=token_for(staff["admin"]), query="include_archived=true")
    assert resp.status == 200
    old = [r for r in resp.json["employees"] if r["email"] == "old@acme.test"]
    assert len(old) == 1 and old[0]["archived_at"] is not None


def test_manager_cannot_include_archived(api, staff, token_for):
    resp = api("GET", LIST, token=token_for(staff["manager"]), query="include_archived=true")
    assert resp.status == 403


def test_include_archived_false_is_allowed_for_manager(api, staff, token_for):
    resp = api("GET", LIST, token=token_for(staff["manager"]), query="include_archived=false")
    assert resp.status == 200


@pytest.mark.parametrize("value", ["yes", "1", "TRUE", ""])
def test_include_archived_must_be_true_or_false(api, staff, token_for, value):
    resp = api("GET", LIST, token=token_for(staff["admin"]), query=f"include_archived={value}")
    assert resp.status == 400


# =====================================================================
# GET /{id}
# =====================================================================
def test_admin_sees_anyone_with_salary(api, staff, token_for):
    resp = api("GET", _one(staff["employee"]["id"]), token=token_for(staff["admin"]))
    assert resp.status == 200
    assert set(resp.json) == ADMIN_KEYS
    assert resp.json["salary"] == 90000


def test_manager_sees_anyone_without_salary(api, staff, token_for):
    resp = api("GET", _one(staff["admin"]["id"]), token=token_for(staff["manager"]))
    assert resp.status == 200
    assert set(resp.json) == BASE_KEYS
    assert "salary" not in resp.text


def test_employee_sees_own_record_without_salary(api, staff, token_for):
    emp = staff["employee"]
    resp = api("GET", _one(emp["id"]), token=token_for(emp))
    assert resp.status == 200
    assert resp.json == {"id": str(emp["id"]), "name": "Eve Employee", "email": "eve@acme.test",
                         "job_title": "Engineer", "role": "employee"}


@pytest.mark.parametrize("target", ["admin", "manager"])
def test_employee_cannot_read_someone_else(api, staff, token_for, target):
    resp = api("GET", _one(staff[target]["id"]), token=token_for(staff["employee"]))
    assert resp.status == 403
    assert staff[target]["email"] not in resp.text


def test_employee_gets_the_same_403_for_an_id_that_does_not_exist(api, staff, token_for):
    # Same answer as for a real colleague, so ids cannot be probed.
    resp = api("GET", _one(uuid.uuid4()), token=token_for(staff["employee"]))
    assert resp.status == 403


@pytest.mark.parametrize("bad_id", ["not-a-uuid", "123", "' OR 1=1 --"])
def test_malformed_id_is_404(api, staff, token_for, bad_id):
    resp = api("GET", _one(bad_id), token=token_for(staff["admin"]))
    assert resp.status == 404


def test_unknown_id_is_404(api, staff, token_for):
    resp = api("GET", _one(uuid.uuid4()), token=token_for(staff["admin"]))
    assert resp.status == 404 and resp.json["error"]["code"] == "not_found"


def test_archived_record_is_visible_to_admin_only(api, staff, make_employee, token_for):
    old = make_employee(email="old@acme.test", name="Old Timer", archived=True)
    assert api("GET", _one(old["id"]), token=token_for(staff["admin"])).status == 200
    assert api("GET", _one(old["id"]), token=token_for(staff["manager"])).status == 404


def test_get_without_a_token_is_401(api, staff):
    assert api("GET", _one(staff["employee"]["id"])).status == 401


# =====================================================================
# Never leaked, whoever asks
# =====================================================================
@pytest.mark.parametrize("who", ["admin", "manager"])
def test_internal_columns_are_never_returned(api, staff, token_for, who):
    texts = [api("GET", LIST, token=token_for(staff[who])).text,
             api("GET", _one(staff["employee"]["id"]), token=token_for(staff[who])).text]
    for text in texts:
        for word in NEVER_RETURNED:
            assert word not in text
        assert "scrypt$" not in text


def test_role_comes_from_the_database_not_the_token(api, staff):
    # A token claiming "admin" for an employee account grants nothing extra.
    from common import auth
    forged = auth.make_access_token(staff["employee"]["id"], "admin")
    assert api("GET", LIST, token=forged).status == 403


def test_an_archived_callers_token_stops_working(api, make_employee, token_for):
    gone = make_employee(email="gone@acme.test", role="admin", archived=True)
    assert api("GET", LIST, token=token_for(gone)).status == 401
