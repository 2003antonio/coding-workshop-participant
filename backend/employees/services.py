"""Employee business rules: who may see which record, who sees salary, and
the archive / last-admin safety rules.

routes.py has already checked the caller's minimum role; the rules here are
the ones that depend on WHICH record is being read or changed.
"""

from decimal import Decimal

import repository
from common import audit, auth, db
from common.errors import Conflict, Forbidden, NotFound

_NOT_FOUND = ("Employee not found.", "not_found")


def _view(row: dict, viewer_role: str) -> dict:
    """The public shape of an employee. Salary and archive state are admin-only.

    Built from an explicit list of keys, so a new column never leaks by accident.
    """
    view = {
        "id": str(row["id"]),
        "name": row["name"],
        "email": row["email"],
        "job_title": row["job_title"],
        "role": row["role"],
    }
    if viewer_role == "admin":
        view["salary"] = float(row["salary"])
        view["archived_at"] = row["archived_at"].isoformat() if row["archived_at"] else None
    return view


def _require_still_admin(actor: dict) -> set:
    """Lock the active admins and check the actor is still one of them.

    The actor was loaded before this transaction; another admin may have
    archived or demoted them since. Returns the locked set of active admin ids.
    """
    admins = repository.lock_active_admin_ids()
    if str(actor["id"]) not in admins:
        raise Forbidden()
    return admins


def list_employees(actor: dict, include_archived: bool) -> list:
    """Every employee; archived ones only for an admin who asks for them."""
    if include_archived and actor["role"] != "admin":
        raise Forbidden()
    return [_view(row, actor["role"]) for row in repository.list_employees(include_archived)]


def get_employee(actor: dict, employee_id: str) -> dict:
    """One employee. An employee may read only their own record.

    The ownership check runs before the lookup, so an employee cannot learn
    whether another id exists. Archived records are visible to admins only.
    """
    if actor["role"] == "employee" and str(actor["id"]) != employee_id:
        raise Forbidden()
    row = repository.find_employee(employee_id)
    if row is None or (row["archived_at"] is not None and actor["role"] != "admin"):
        raise NotFound(*_NOT_FOUND)
    return _view(row, actor["role"])


def create_employee(actor: dict, email: str, name: str, role: str, job_title: str,
                    salary: Decimal, password: str) -> dict:
    """Create an employee. A taken email (any case) is a 409."""
    password_hash = auth.hash_password(password)
    with db.transaction():
        row = repository.insert_employee(email, name, role, job_title, salary, password_hash)
        if row is None:
            raise Conflict("An employee with that email already exists.", "email_taken")
        audit.record("employee_created", actor["id"], "employee", row["id"])
    return _view(row, "admin")


def update_employee(actor: dict, employee_id: str, changes: dict) -> dict:
    """Change name, job_title, role and/or salary.

    Role and salary changes are audited by action name only: the old and new
    values never reach the audit log. The last active admin cannot be demoted.
    """
    with db.transaction():
        admins = _require_still_admin(actor)
        row = repository.find_employee_for_update(employee_id)
        if row is None:
            raise NotFound(*_NOT_FOUND)
        if row["archived_at"] is not None:
            raise Conflict("Archived employees cannot be changed.", "archived")

        changed = {field: value for field, value in changes.items() if value != row[field]}
        losing_admin = "role" in changed and row["role"] == "admin"
        if losing_admin and len(admins) <= 1:
            raise Conflict("The last active admin cannot lose the admin role.", "last_admin")
        if not changed:
            return _view(row, "admin")

        updated = repository.update_employee(employee_id, **changed)
        if "role" in changed:
            audit.record("employee_role_changed", actor["id"], "employee", employee_id)
        if "salary" in changed:
            audit.record("employee_salary_changed", actor["id"], "employee", employee_id)
        other_fields = sorted(set(changed) - {"role", "salary"})
        if other_fields:
            audit.record("employee_updated", actor["id"], "employee", employee_id,
                         {"fields": other_fields})
    return _view(updated, "admin")


def archive_employee(actor: dict, employee_id: str) -> dict:
    """Archive (never delete) an employee.

    The last active admin can never be archived. That follows from two rules
    checked here under one lock: the caller must still be an active admin, and
    an admin cannot archive themselves. So at least the caller stays active,
    even when two admins try to archive each other at the same moment.
    """
    if str(actor["id"]) == employee_id:
        raise Conflict("You cannot archive yourself.", "cannot_archive_self")
    with db.transaction():
        _require_still_admin(actor)
        row = repository.find_employee_for_update(employee_id)
        if row is None:
            raise NotFound(*_NOT_FOUND)
        if row["archived_at"] is not None:
            raise Conflict("That employee is already archived.", "already_archived")
        archived = repository.archive_employee(employee_id)
        audit.record("employee_archived", actor["id"], "employee", employee_id)
    return _view(archived, "admin")
