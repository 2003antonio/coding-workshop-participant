"""Project and deliverable business rules (docs/api-contract.md sections 4, 5, 7).

routes.py has already authenticated the caller and checked the minimum role;
the rules here depend on WHICH project is being read or changed.

Visibility: an admin sees every project; a manager sees the projects of teams
they lead (archived ones too); an employee sees active projects where they
have an active allocation. A project the caller cannot see is a 404, as is
everything under it. Changing a project needs admin or its manager (403).
"""

import datetime
from decimal import Decimal
from typing import Optional

import repository
from common import audit, budget, db, weeks
from common.errors import BadRequest, Conflict, Forbidden, NotFound

PROJECT_STATUSES = ("planned", "active", "on_hold", "completed")
DELIVERABLE_STATUSES = ("not_started", "in_progress", "done")
_STARTED = ("in_progress", "done")
MAX_DEPENDENCIES = 50

_PROJECT_NOT_FOUND = ("Project not found.", "not_found")
_DELIVERABLE_NOT_FOUND = ("Deliverable not found.", "not_found")


def _iso(value) -> Optional[str]:
    return value.isoformat() if value is not None else None


# =====================================================================
# Visibility and permission
# =====================================================================
def _can_see(actor: dict, row: Optional[dict]) -> bool:
    if row is None:
        return False
    if actor["role"] == "admin":
        return True
    if actor["role"] == "manager":
        return str(row["manager_id"]) == str(actor["id"])
    return row["archived_at"] is None and repository.has_active_allocation(
        str(row["id"]), str(actor["id"]))


def _can_manage(actor: dict, row: dict) -> bool:
    return actor["role"] == "admin" or str(row["manager_id"]) == str(actor["id"])


def _visible_project(actor: dict, project_id: str) -> dict:
    row = repository.find_project(project_id)
    if not _can_see(actor, row):
        raise NotFound(*_PROJECT_NOT_FOUND)
    return row


def _lock_for_change(actor: dict, project_id: str) -> dict:
    """Inside a transaction: 404 if hidden, 403 if not admin or its manager,
    409 if archived. Returns the locked project row."""
    row = _visible_project(actor, project_id)
    if not _can_manage(actor, row):
        raise Forbidden()
    row = repository.lock_project(project_id)
    if row["archived_at"] is not None:
        raise Conflict("Archived projects cannot be changed.", "archived")
    return row


def _include_archived_allowed(actor: dict, include_archived: bool) -> None:
    if include_archived and actor["role"] == "employee":
        raise Forbidden()


# =====================================================================
# Projects
# =====================================================================
def _project_view(row: dict, actor: dict) -> dict:
    """The public shape of a project. planned_budget is a typed-in figure, not a
    salary, so the project's manager sees it too; employees never do."""
    view = {
        "id": str(row["id"]),
        "team": {"id": str(row["team_id"]), "name": row["team_name"]},
        "manager": {"id": str(row["manager_id"]), "name": row["manager_name"]},
        "name": row["name"],
        "description": row["description"],
        "status": row["status"],
        "start_date": _iso(row["start_date"]),
        "end_date": _iso(row["end_date"]),
        "archived_at": _iso(row["archived_at"]),
    }
    if _can_manage(actor, row):
        view["planned_budget"] = budget.money(row["planned_budget"])
    return view


def list_projects(actor: dict, include_archived: bool, team_id: Optional[str],
                  status: Optional[str], q: Optional[str] = None) -> list:
    """Visible projects, narrowed by the filters. The visibility filter is always
    applied in the same query, so q can only narrow, never reveal."""
    _include_archived_allowed(actor, include_archived)
    actor_id = str(actor["id"])
    if actor["role"] == "admin":
        rows = repository.list_projects(include_archived, team_id, status, q=q)
    elif actor["role"] == "manager":
        rows = repository.list_projects(include_archived, team_id, status, lead_id=actor_id, q=q)
    else:
        rows = repository.list_projects(False, team_id, status, allocated_to=actor_id, q=q)
    return [_project_view(row, actor) for row in rows]


def get_project(actor: dict, project_id: str) -> dict:
    return _project_view(_visible_project(actor, project_id), actor)


def _check_team(actor: dict, team_id: str) -> None:
    """The team must be active (400 invalid_team); a manager must lead it (403)."""
    team = repository.lock_team(team_id)
    if team is None or team["archived_at"] is not None:
        raise BadRequest("The team must be an active team.", "invalid_team")
    if actor["role"] != "admin" and str(team["lead_id"]) != str(actor["id"]):
        raise Forbidden()


def create_project(actor: dict, team_id: str, name: str, description: str, status: str,
                   start_date: datetime.date, end_date: datetime.date,
                   planned_budget: Optional[Decimal] = None) -> dict:
    if start_date > end_date:
        raise BadRequest("start_date must not be after end_date.", "invalid_dates")
    with db.transaction():
        _check_team(actor, team_id)
        project_id = repository.insert_project(team_id, name, description, status,
                                               start_date, end_date, planned_budget)
        audit.record("project_created", actor["id"], "project", project_id)
    return get_project(actor, project_id)


def update_project(actor: dict, project_id: str, changes: dict) -> dict:
    with db.transaction():
        row = _lock_for_change(actor, project_id)
        if "team_id" in changes and actor["role"] != "admin":
            raise Forbidden()
        changed = {key: value for key, value in changes.items()
                   if value != (str(row[key]) if key == "team_id" else row[key])}
        start = changed.get("start_date", row["start_date"])
        end = changed.get("end_date", row["end_date"])
        if start > end:
            raise BadRequest("start_date must not be after end_date.", "invalid_dates")
        if "team_id" in changed:
            _check_team(actor, changed["team_id"])
        if ("start_date" in changed or "end_date" in changed) and \
                repository.has_work_outside(project_id, start, end):
            raise Conflict("A deliverable or allocation would fall outside the new dates.",
                           "dates_conflict")
        if changed.get("status") == "completed" and repository.has_open_deliverables(project_id):
            raise Conflict("Every deliverable must be done first.", "deliverables_open")
        if changed:
            repository.update_project(project_id, changed)
            audit.record("project_updated", actor["id"], "project", project_id,
                         {"fields": sorted(changed)})
    return get_project(actor, project_id)


def archive_project(actor: dict, project_id: str) -> dict:
    """Archive a project and, with it, its deliverables and allocations."""
    with db.transaction():
        row = _visible_project(actor, project_id)
        if not _can_manage(actor, row):
            raise Forbidden()
        if repository.lock_project(project_id)["archived_at"] is not None:
            raise Conflict("That project is already archived.", "already_archived")
        repository.archive_project(project_id)
        audit.record("project_archived", actor["id"], "project", project_id)
    return get_project(actor, project_id)


def project_budget(actor: dict, project_id: str) -> dict:
    """Committed and used-to-date cost from the project's allocations, plus the
    typed-in planned budget.

    Admin and the project's manager only. Per-person lines (with hourly rates)
    are admin-only. A manager gets the cost totals only when at least
    MIN_AGGREGATE_GROUP distinct people are allocated; otherwise nulls.
    planned_budget is not salary-derived, so it is always shown to them.
    """
    row = _visible_project(actor, project_id)
    if not _can_manage(actor, row):
        raise Forbidden()
    today = weeks.today()
    committed = used = Decimal(0)
    lines, people = [], set()
    for alloc in repository.budget_allocations(project_id):
        cost = budget.allocation_cost(alloc["hours_per_week"], alloc["salary"],
                                      alloc["start_date"], alloc["end_date"], today)
        committed += cost["planned"]
        used += cost["used"]
        people.add(str(alloc["employee_id"]))
        lines.append({
            "allocation_id": str(alloc["id"]),
            "employee": {"id": str(alloc["employee_id"]), "name": alloc["employee_name"]},
            "hours_per_week": alloc["hours_per_week"],
            "weeks": cost["weeks"],
            "hourly_rate": budget.money(budget.hourly_rate(alloc["salary"])),
            "committed_cost": budget.money(cost["planned"]),
            "used_cost_to_date": budget.money(cost["used"]),
        })
    hidden = budget.is_hidden(actor["role"], len(people))
    result = {
        "project_id": project_id,
        "planned_budget": budget.money(row["planned_budget"]),
        "committed_cost": None if hidden else budget.money(committed),
        "used_cost_to_date": None if hidden else budget.money(used),
        "allocated_people": len(people),
        "hidden_reason": budget.hidden_reason(hidden),
    }
    if actor["role"] == "admin":
        result["lines"] = lines
    return result


# =====================================================================
# Deliverables
# =====================================================================
class _Graph:
    """A project's deliverables and dependency edges, loaded once per request."""

    def __init__(self, project_id: str):
        self.rows = {str(r["id"]): r for r in repository.list_deliverables(project_id)}
        self.depends_on = {key: set() for key in self.rows}
        for edge in repository.dependency_edges(project_id):
            self.depends_on[str(edge["deliverable_id"])].add(str(edge["depends_on_id"]))

    def active(self, deliverable_id: str) -> bool:
        row = self.rows.get(deliverable_id)
        return row is not None and row["archived_at"] is None

    def done(self, deliverable_id: str) -> bool:
        return self.rows[deliverable_id]["status"] == "done"

    def pending(self, deliverable_id: str, among=None) -> list:
        """Active dependencies (or those in `among`) that are not done, sorted."""
        ids = self.depends_on[deliverable_id] if among is None else among
        return sorted(d for d in ids if self.active(d) and not self.done(d))

    def started_dependents(self, deliverable_id: str) -> list:
        return sorted(key for key, deps in self.depends_on.items()
                      if deliverable_id in deps and self.active(key)
                      and self.rows[key]["status"] in _STARTED)

    def active_dependents(self, deliverable_id: str) -> list:
        return sorted(key for key, deps in self.depends_on.items()
                      if deliverable_id in deps and self.active(key))

    def cycle_through(self, deliverable_id: str, new_deps: set) -> Optional[list]:
        """If deliverable_id depended on new_deps, return a cycle [deliverable_id, ...]
        (each id depends on the next, the last depends on deliverable_id), else None."""
        for start in sorted(new_deps):
            path = self._path(start, deliverable_id)
            if path is not None:
                return [deliverable_id] + path[:-1]
        return None

    def _path(self, source: str, target: str) -> Optional[list]:
        """A dependency path source -> ... -> target over active deliverables (BFS)."""
        previous = {source: None}
        queue = [source]
        while queue:
            node = queue.pop(0)
            if node == target:
                path = []
                while node is not None:
                    path.append(node)
                    node = previous[node]
                return path[::-1]
            for nxt in sorted(self.depends_on.get(node, ())):
                if nxt not in previous and self.active(nxt):
                    previous[nxt] = node
                    queue.append(nxt)
        return None

    def view(self, deliverable_id: str, today: datetime.date) -> dict:
        row = self.rows[deliverable_id]
        return {
            "id": deliverable_id,
            "project_id": str(row["project_id"]),
            "name": row["name"],
            "description": row["description"],
            "start_date": _iso(row["start_date"]),
            "due_date": _iso(row["due_date"]),
            "status": row["status"],
            "completed_at": _iso(row["completed_at"]),
            "depends_on": sorted(self.depends_on[deliverable_id]),
            "blocked": bool(self.pending(deliverable_id)),
            "overdue": row["status"] != "done" and row["due_date"] < today,
            "archived_at": _iso(row["archived_at"]),
        }


def _deliverable_in(graph: _Graph, deliverable_id: str, actor: dict) -> dict:
    row = graph.rows.get(deliverable_id)
    if row is None or (row["archived_at"] is not None and actor["role"] == "employee"):
        raise NotFound(*_DELIVERABLE_NOT_FOUND)
    return row


def _check_dates(project: dict, start: datetime.date, due: datetime.date) -> None:
    if not project["start_date"] <= start <= due <= project["end_date"]:
        raise BadRequest("Dates must be in order and inside the project's dates.", "invalid_dates")


def _check_dependency_ids(graph: _Graph, deliverable_id: Optional[str], depends_on: list) -> set:
    """Each must be an active deliverable of this project, and not the deliverable itself."""
    ids = set(depends_on)
    if len(ids) > MAX_DEPENDENCIES:
        raise BadRequest(f"At most {MAX_DEPENDENCIES} dependencies.", "invalid_dependency")
    for dep in ids:
        if dep is None or dep == deliverable_id or not graph.active(dep):
            raise BadRequest("Dependencies must be other active deliverables of this project.",
                             "invalid_dependency")
    return ids


def list_deliverables(actor: dict, project_id: str, include_archived: bool) -> list:
    _include_archived_allowed(actor, include_archived)
    _visible_project(actor, project_id)
    graph, today = _Graph(project_id), weeks.today()
    return [graph.view(key, today) for key in graph.rows
            if include_archived or graph.active(key)]


def get_deliverable(actor: dict, project_id: str, deliverable_id: str) -> dict:
    _visible_project(actor, project_id)
    graph = _Graph(project_id)
    _deliverable_in(graph, deliverable_id, actor)
    return graph.view(deliverable_id, weeks.today())


def create_deliverable(actor: dict, project_id: str, name: str, description: str,
                       start_date: datetime.date, due_date: datetime.date,
                       depends_on: list) -> dict:
    with db.transaction():
        project = _lock_for_change(actor, project_id)
        _check_dates(project, start_date, due_date)
        deps = _check_dependency_ids(_Graph(project_id), None, depends_on)
        deliverable_id = repository.insert_deliverable(project_id, name, description,
                                                       start_date, due_date)
        repository.replace_dependencies(deliverable_id, sorted(deps))
        audit.record("deliverable_created", actor["id"], "deliverable", deliverable_id)
    return get_deliverable(actor, project_id, deliverable_id)


def _lock_deliverable(actor: dict, project_id: str, deliverable_id: str):
    """Lock the project for a deliverable change; returns (project, graph, row)."""
    project = _lock_for_change(actor, project_id)
    graph = _Graph(project_id)
    row = _deliverable_in(graph, deliverable_id, actor)
    if row["archived_at"] is not None:
        raise Conflict("Archived deliverables cannot be changed.", "archived")
    return project, graph, row


def update_deliverable(actor: dict, project_id: str, deliverable_id: str, changes: dict) -> dict:
    """Change fields and/or status, enforcing the start rule both ways:
    a deliverable cannot start before its dependencies are done, and a done
    deliverable cannot be reopened once something depending on it has started."""
    with db.transaction():
        project, graph, row = _lock_deliverable(actor, project_id, deliverable_id)
        changed = {key: value for key, value in changes.items() if value != row[key]}
        _check_dates(project, changed.get("start_date", row["start_date"]),
                     changed.get("due_date", row["due_date"]))
        new_status = changed.get("status")
        if new_status in _STARTED:
            pending = graph.pending(deliverable_id)
            if pending:
                raise Conflict("Some dependencies are not done yet.", "dependencies_not_done",
                               details={"pending": pending})
        if new_status is not None and row["status"] == "done":
            if graph.started_dependents(deliverable_id):
                raise Conflict("A deliverable that depends on this one has already started.",
                               "dependents_started")
        if changed:
            repository.update_deliverable(deliverable_id, changed)
            audit.record("deliverable_updated", actor["id"], "deliverable", deliverable_id,
                         {"fields": sorted(changed)})
    return get_deliverable(actor, project_id, deliverable_id)


def set_dependencies(actor: dict, project_id: str, deliverable_id: str, depends_on: list) -> dict:
    """Replace a deliverable's dependency set, refusing any change that would
    make a cycle. The project row lock makes the check and the write atomic, so
    two concurrent edits cannot build a cycle together."""
    with db.transaction():
        _, graph, row = _lock_deliverable(actor, project_id, deliverable_id)
        new_deps = _check_dependency_ids(graph, deliverable_id, depends_on)
        cycle = graph.cycle_through(deliverable_id, new_deps)
        if cycle is not None:
            raise Conflict("That would create a dependency cycle.", "dependency_cycle",
                           details={"cycle": cycle})
        if row["status"] in _STARTED:
            pending = graph.pending(deliverable_id, among=new_deps - graph.depends_on[deliverable_id])
            if pending:
                raise Conflict("A started deliverable cannot gain an unfinished dependency.",
                               "dependencies_not_done", details={"pending": pending})
        if new_deps != graph.depends_on[deliverable_id]:
            repository.replace_dependencies(deliverable_id, sorted(new_deps))
            audit.record("deliverable_dependencies_changed", actor["id"], "deliverable",
                         deliverable_id)
    return get_deliverable(actor, project_id, deliverable_id)


def archive_deliverable(actor: dict, project_id: str, deliverable_id: str) -> dict:
    with db.transaction():
        _lock_for_change(actor, project_id)
        graph = _Graph(project_id)
        row = _deliverable_in(graph, deliverable_id, actor)
        if row["archived_at"] is not None:
            raise Conflict("That deliverable is already archived.", "already_archived")
        if graph.active_dependents(deliverable_id):
            raise Conflict("Other deliverables depend on this one.", "has_dependents")
        repository.archive_deliverable(deliverable_id)
        audit.record("deliverable_archived", actor["id"], "deliverable", deliverable_id)
    return get_deliverable(actor, project_id, deliverable_id)
