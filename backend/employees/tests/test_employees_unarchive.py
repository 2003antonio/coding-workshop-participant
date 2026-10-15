"""POST /{id}/unarchive: admin only, the record only, audited, 404 when not archived."""

import uuid

import pytest

pytestmark = pytest.mark.integration

LIST = "/api/employees/"


def _unarchive(employee_id):
    return f"/api/employees/{employee_id}/unarchive"


def test_admin_unarchives_an_employee_record_only(api, staff, make_employee, token_for, migrated_db,
                                                  audit_rows):
    old = make_employee(email="old@acme.test", name="Old Timer", salary=91000, archived=True)
    resp = api("POST", _unarchive(old["id"]), token=token_for(staff["admin"]))
    assert resp.status == 200
    assert resp.json["archived_at"] is None and resp.json["name"] == "Old Timer"
    assert resp.json["salary"] == 91000  # the admin's usual shape
    listed = api("GET", LIST, token=token_for(staff["admin"])).json["employees"]
    assert str(old["id"]) in {e["id"] for e in listed}
    assert [(r["action"], r["entity_id"], r["details"]) for r in audit_rows("employee_unarchived")] == [
        ("employee_unarchived", old["id"], None)]
    # They can be used again (e.g. their token works once more).
    assert api("GET", f"/api/employees/{old['id']}", token=token_for(old)).status == 200


def test_unarchive_leaves_old_allocations_archived(api, staff, make_employee, token_for, migrated_db):
    team = migrated_db.query_one(
        "INSERT INTO teams (name, lead_id) VALUES ('T', %s) RETURNING id", (str(staff["manager"]["id"]),))
    old = make_employee(email="old@acme.test", archived=True)
    project = migrated_db.query_one(
        "INSERT INTO projects (team_id, name, status, start_date, end_date) "
        "VALUES (%s, 'P', 'active', '2026-11-02', '2027-01-29') RETURNING id", (str(team["id"]),))
    migrated_db.execute(
        "INSERT INTO allocations (employee_id, project_id, hours_per_week, start_date, end_date, created_by, "
        "archived_at) VALUES (%s, %s, 10, '2026-11-02', '2026-12-18', %s, now())",
        (str(old["id"]), str(project["id"]), str(staff["admin"]["id"])))
    assert api("POST", _unarchive(old["id"]), token=token_for(staff["admin"])).status == 200
    row = migrated_db.query_one("SELECT archived_at FROM allocations WHERE employee_id = %s", (str(old["id"]),))
    assert row["archived_at"] is not None


@pytest.mark.parametrize("who", ["manager", "employee"])
def test_only_an_admin_may_unarchive(api, staff, make_employee, token_for, who, audit_rows):
    old = make_employee(email="old@acme.test", archived=True)
    resp = api("POST", _unarchive(old["id"]), token=token_for(staff[who]))
    assert resp.status == 403
    assert audit_rows("employee_unarchived") == []


def test_not_archived_or_unknown_is_404(api, staff, token_for):
    admin = token_for(staff["admin"])
    for target in (staff["employee"]["id"], uuid.uuid4(), "nope"):
        resp = api("POST", _unarchive(target), token=admin)
        assert resp.status == 404 and resp.json["error"]["code"] == "not_found", target
