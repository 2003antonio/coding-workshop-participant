"""Allocation business rules (docs/api-contract.md section 6).

routes.py has already authenticated the caller and checked the minimum role.

Visibility: an admin sees every allocation; a manager sees those on projects
of teams they lead; an employee sees their own. Anything else is a 404.

Changing: an admin may allocate anyone to any project. A manager may only
allocate a member of a team they lead, on that team's project (403).

The 40-hour rule: in every week the allocation touches, the person's total
across ALL their active allocations (including projects the caller cannot
see) must stay at or below 40. Other projects are never named in the error.
"""

import datetime
from typing import Optional

import repository
from common import audit, budget, db, weeks
from common.errors import BadRequest, Conflict, Forbidden, NotFound

MAX_HOURS_PER_WEEK = 40
_NOT_FOUND = ("Allocation not found.", "not_found")
_PROJECT_NOT_FOUND = ("Project not found.", "not_found")
_CLOSED = ("completed",)


def _view(row: dict, viewer_role: str) -> dict:
    """The public shape of an allocation. Rate and cost are admin-only."""
    view = {
        "id": str(row["id"]),
        "employee": {"id": str(row["employee_id"]), "name": row["employee_name"]},
        "project": {"id": str(row["project_id"]), "name": row["project_name"]},
        "hours_per_week": row["hours_per_week"],
        "start_date": row["start_date"].isoformat(),
        "end_date": row["end_date"].isoformat(),
        "archived_at": row["archived_at"].isoformat() if row["archived_at"] else None,
    }
    if viewer_role == "admin":
        rate = budget.hourly_rate(row["salary"])
        view["hourly_rate"] = budget.money(rate)
        view["weekly_cost"] = budget.money(rate * row["hours_per_week"])
    return view


def _can_see(actor: dict, row: Optional[dict]) -> bool:
    if row is None:
        return False
    if actor["role"] == "admin":
        return True
    if actor["role"] == "manager":
        return str(row["manager_id"]) == str(actor["id"])
    return row["archived_at"] is None and str(row["employee_id"]) == str(actor["id"])


# =====================================================================
# Reads
# =====================================================================
def list_allocations(actor: dict, include_archived: bool, project_id: Optional[str],
                     employee_id: Optional[str], date_from: Optional[datetime.date],
                     date_to: Optional[datetime.date]) -> list:
    role, actor_id = actor["role"], str(actor["id"])
    if include_archived and role == "employee":
        raise Forbidden()
    if role == "admin":
        rows = repository.list_allocations(include_archived, project_id, employee_id, date_from, date_to)
    elif role == "manager":
        rows = repository.list_allocations(include_archived, project_id, employee_id, date_from,
                                           date_to, lead_id=actor_id)
    else:
        if employee_id is not None and employee_id != actor_id:
            return []
        rows = repository.list_allocations(False, project_id, actor_id, date_from, date_to)
    return [_view(row, role) for row in rows]


def get_allocation(actor: dict, allocation_id: str) -> dict:
    row = repository.find_allocation(allocation_id)
    if not _can_see(actor, row):
        raise NotFound(*_NOT_FOUND)
    return _view(row, actor["role"])


# =====================================================================
# Rules shared by create and update
# =====================================================================
def _check_project(actor: dict, project_id: str) -> dict:
    """Share-lock the project: 404 if the caller cannot see it."""
    project = repository.lock_project(project_id)
    if project is None or (actor["role"] != "admin"
                           and str(project["manager_id"]) != str(actor["id"])):
        raise NotFound(*_PROJECT_NOT_FOUND)
    return project


def _check_employee(actor: dict, employee_id: str, project: dict) -> None:
    """Lock the employee; they must be active and, for a manager, on the project's team."""
    employee = repository.lock_employee(employee_id)
    if employee is None or employee["archived_at"] is not None:
        raise BadRequest("The employee must be an active employee.", "invalid_employee")
    if actor["role"] != "admin" and str(employee["team_id"] or "") != str(project["team_id"]):
        raise Forbidden()


def _check_open_project(project: dict) -> None:
    if project["archived_at"] is not None or project["status"] in _CLOSED:
        raise Conflict("The project is archived or completed.", "project_closed")


def _check_dates(project: dict, start: datetime.date, end: datetime.date) -> None:
    if not project["start_date"] <= start <= end <= project["end_date"]:
        raise BadRequest("Dates must be in order and inside the project's dates.", "invalid_dates")


def _check_capacity(employee_id: str, project_id: str, hours: int, start: datetime.date,
                    end: datetime.date, except_id: Optional[str]) -> None:
    """No overlapping allocation on the same project, and at most 40 hours in
    every week the range touches. Runs while the employee row is locked."""
    span_start = weeks.week_start(start)
    span_end = weeks.week_start(end) + datetime.timedelta(days=6)
    others = repository.other_allocations(employee_id, span_start, span_end, except_id)
    for other in others:
        if str(other["project_id"]) == project_id and \
                other["start_date"] <= end and other["end_date"] >= start:
            raise Conflict("This person already has an overlapping allocation on this project; "
                           "edit that one instead.", "overlapping_allocation")
    over = []
    for monday in weeks.weeks_touched(start, end):
        sunday = monday + datetime.timedelta(days=6)
        total = hours + sum(o["hours_per_week"] for o in others
                            if o["start_date"] <= sunday and o["end_date"] >= monday)
        if total > MAX_HOURS_PER_WEEK:
            over.append({"week_start": monday.isoformat(), "hours": total})
    if over:
        raise Conflict("This would put the person over 40 hours in some weeks.", "over_allocated",
                       details={"weeks": over})


def _lock_for_change(actor: dict, allocation_id: str) -> tuple:
    """404 if hidden; then lock project and employee and apply the team rule (403)."""
    row = repository.find_allocation(allocation_id)
    if not _can_see(actor, row):
        raise NotFound(*_NOT_FOUND)
    project = _check_project(actor, str(row["project_id"]))
    _check_employee_for_change(actor, str(row["employee_id"]), project)
    return repository.lock_allocation(allocation_id), project


def _check_employee_for_change(actor: dict, employee_id: str, project: dict) -> None:
    """Like _check_employee, but an archived person's allocation may still be
    changed by an admin (e.g. to archive it)."""
    employee = repository.lock_employee(employee_id)
    if actor["role"] != "admin" and (employee["archived_at"] is not None
                                     or str(employee["team_id"] or "") != str(project["team_id"])):
        raise Forbidden()


# =====================================================================
# Writes
# =====================================================================
def create_allocation(actor: dict, employee_id: str, project_id: str, hours_per_week: int,
                      start_date: datetime.date, end_date: datetime.date) -> dict:
    with db.transaction():
        project = _check_project(actor, project_id)
        _check_employee(actor, employee_id, project)
        _check_open_project(project)
        _check_dates(project, start_date, end_date)
        _check_capacity(employee_id, project_id, hours_per_week, start_date, end_date, None)
        allocation_id = repository.insert_allocation(employee_id, project_id, hours_per_week,
                                                     start_date, end_date, str(actor["id"]))
        audit.record("allocation_created", actor["id"], "allocation", allocation_id)
    return get_allocation(actor, allocation_id)


def update_allocation(actor: dict, allocation_id: str, changes: dict) -> dict:
    """Change hours and/or dates; the 40-hour check runs again without counting itself."""
    with db.transaction():
        row, project = _lock_for_change(actor, allocation_id)
        if row["archived_at"] is not None:
            raise Conflict("Archived allocations cannot be changed.", "archived")
        _check_open_project(project)
        hours = changes.get("hours_per_week", row["hours_per_week"])
        start = changes.get("start_date", row["start_date"])
        end = changes.get("end_date", row["end_date"])
        _check_dates(project, start, end)
        _check_capacity(str(row["employee_id"]), str(row["project_id"]), hours, start, end,
                        allocation_id)
        repository.update_allocation(allocation_id, hours, start, end)
        audit.record("allocation_updated", actor["id"], "allocation", allocation_id,
                     {"fields": sorted(changes)})
    return get_allocation(actor, allocation_id)


def archive_allocation(actor: dict, allocation_id: str) -> dict:
    with db.transaction():
        row, _ = _lock_for_change(actor, allocation_id)
        if row["archived_at"] is not None:
            raise Conflict("That allocation is already archived.", "already_archived")
        repository.archive_allocation(allocation_id)
        audit.record("allocation_archived", actor["id"], "allocation", allocation_id)
    return get_allocation(actor, allocation_id)
