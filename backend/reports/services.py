"""The seven reports (docs/api-contract.md section 8). Read-only.

Every report covers only what the caller can see (contract section 4), and
money follows section 7: no per-person figures, and totals hidden from
non-admins below MIN_AGGREGATE_GROUP people.

routes.py has already authenticated the caller, checked the minimum role and
parsed the query; date windows arrive as (first Monday, last day).
"""

import datetime
from collections import defaultdict
from decimal import Decimal
from typing import Optional

import repository
from common import budget, weeks
from common.errors import NotFound

_STARTED_OR_DONE = ("in_progress", "done")


def _iso(value) -> Optional[str]:
    return value.isoformat() if value is not None else None


def _ref(row: dict, id_key: str, name_key: str) -> dict:
    return {"id": str(row[id_key]), "name": row[name_key]}


def _project_ids(projects: list) -> list:
    return [str(p["id"]) for p in projects]


class _Deliverables:
    """Active deliverables of some projects with their dependency edges."""

    def __init__(self, project_ids: list, today: datetime.date):
        rows = repository.deliverables(project_ids) if project_ids else []
        edges = repository.dependency_edges(project_ids) if project_ids else []
        self.today = today
        self.rows = {str(r["id"]): r for r in rows}
        self.depends_on = defaultdict(set)
        self.dependents = defaultdict(set)
        for edge in edges:
            child, parent = str(edge["deliverable_id"]), str(edge["depends_on_id"])
            self.depends_on[child].add(parent)
            self.dependents[parent].add(child)
        self.by_project = defaultdict(list)
        for key, row in self.rows.items():
            self.by_project[str(row["project_id"])].append(key)

    def done(self, key: str) -> bool:
        return self.rows[key]["status"] == "done"

    def overdue(self, key: str) -> bool:
        return not self.done(key) and self.rows[key]["due_date"] < self.today

    def blocked(self, key: str) -> bool:
        return any(not self.done(dep) for dep in self.depends_on[key])

    def blocking(self, key: str) -> list:
        """Deliverables this one is holding up: its dependents, while it is not done."""
        return [] if self.done(key) else sorted(self.dependents[key])


# =====================================================================
# 1. Project status
# =====================================================================
def project_status(actor: dict, team_id: Optional[str], status: Optional[str]) -> dict:
    projects = repository.visible_projects(actor["role"], str(actor["id"]), team_id, status)
    graph = _Deliverables(_project_ids(projects), weeks.today())
    result = []
    for project in projects:
        keys = graph.by_project[str(project["id"])]
        counts = {"total": len(keys), "not_started": 0, "in_progress": 0, "done": 0,
                  "overdue": 0, "blocked": 0}
        for key in keys:
            counts[graph.rows[key]["status"]] += 1
            counts["overdue"] += graph.overdue(key)
            counts["blocked"] += graph.blocked(key)
        result.append({
            "id": str(project["id"]),
            "name": project["name"],
            "team": _ref(project, "team_id", "team_name"),
            "manager": _ref(project, "manager_id", "manager_name"),
            "status": project["status"],
            "start_date": _iso(project["start_date"]),
            "end_date": _iso(project["end_date"]),
            "deliverables": counts,
            "percent_complete": budget.percent(Decimal(counts["done"]), Decimal(counts["total"])),
        })
    return {"projects": result}


# =====================================================================
# Project money, shared by at-risk (admin) and the budget report
# =====================================================================
def _project_money(project_ids: list, today: datetime.date) -> dict:
    """{project_id: {"planned", "used", "people"}} with unrounded Decimals.

    "planned" is the committed cost: every active allocation over its full
    range. "used" is the cost of the weeks up to and including this week.
    """
    money = {pid: {"planned": Decimal(0), "used": Decimal(0), "people": set()} for pid in project_ids}
    for alloc in repository.project_allocations(project_ids) if project_ids else []:
        cost = budget.allocation_cost(alloc["hours_per_week"], alloc["salary"],
                                      alloc["start_date"], alloc["end_date"], today)
        entry = money[str(alloc["project_id"])]
        entry["planned"] += cost["planned"]
        entry["used"] += cost["used"]
        entry["people"].add(str(alloc["employee_id"]))
    return money


# =====================================================================
# 2. At-risk projects
# =====================================================================
def at_risk_projects(actor: dict) -> dict:
    today = weeks.today()
    monday = weeks.week_start(today)
    sunday = monday + datetime.timedelta(days=6)
    projects = repository.visible_projects(actor["role"], str(actor["id"]))
    ids = _project_ids(projects)
    graph = _Deliverables(ids, today)
    staffed = {str(a["project_id"]) for a in (repository.project_allocations(ids) if ids else [])
               if a["start_date"] <= sunday and a["end_date"] >= monday}
    money = _project_money(ids, today) if actor["role"] == "admin" else {}

    result = []
    for project in projects:
        pid = str(project["id"])
        keys = graph.by_project[pid]
        open_keys = [k for k in keys if not graph.done(k)]
        reasons = []
        if project["status"] != "completed" and project["end_date"] < today:
            reasons.append("past_end_date")
        if any(graph.overdue(k) for k in keys):
            reasons.append("overdue_deliverable")
        if any(graph.rows[k]["start_date"] < today and graph.blocked(k) for k in open_keys):
            reasons.append("blocked_past_start")
        if any(graph.rows[k]["start_date"] < graph.rows[dep]["due_date"]
               for k in open_keys for dep in graph.depends_on[k] if not graph.done(dep)):
            reasons.append("dependency_date_conflict")
        if project["status"] == "active" and pid not in staffed:
            reasons.append("unstaffed")
        if pid in money and budget.over_budget(money[pid]["planned"], project["planned_budget"]):
            reasons.append("over_budget")
        if reasons:
            result.append({"id": pid, "name": project["name"],
                           "team": _ref(project, "team_id", "team_name"),
                           "manager": _ref(project, "manager_id", "manager_name"),
                           "reasons": reasons})
    return {"projects": result}


# =====================================================================
# 3 and 5. Weekly hours per person
# =====================================================================
def _weekly_hours(actor: dict, team_id: Optional[str], date_from: datetime.date,
                  date_to: datetime.date):
    """People in scope and, per person and week, their allocations in the window."""
    people = repository.people(actor["role"], str(actor["id"]), team_id)
    allocs = repository.people_allocations([str(p["id"]) for p in people], date_from, date_to) \
        if people else []
    by_person = defaultdict(list)
    for alloc in allocs:
        by_person[str(alloc["employee_id"])].append(alloc)
    return people, by_person, weeks.weeks_touched(date_from, date_to)


def _in_week(alloc: dict, monday: datetime.date) -> bool:
    return alloc["start_date"] <= monday + datetime.timedelta(days=6) and alloc["end_date"] >= monday


def resource_allocation(actor: dict, team_id: Optional[str], date_from: datetime.date,
                        date_to: datetime.date) -> dict:
    """Hours per person per week. Hours on projects the caller cannot see are
    summed into other_hours, without names."""
    people, by_person, mondays = _weekly_hours(actor, team_id, date_from, date_to)
    visible = set(_project_ids(repository.visible_projects(actor["role"], str(actor["id"]))))
    result = []
    for person in people:
        person_weeks = []
        for monday in mondays:
            total, other, projects = 0, 0, defaultdict(int)
            names = {}
            for alloc in by_person[str(person["id"])]:
                if not _in_week(alloc, monday):
                    continue
                total += alloc["hours_per_week"]
                pid = str(alloc["project_id"])
                if pid in visible:
                    projects[pid] += alloc["hours_per_week"]
                    names[pid] = alloc["project_name"]
                else:
                    other += alloc["hours_per_week"]
            person_weeks.append({
                "week_start": monday.isoformat(),
                "total_hours": total,
                "projects": [{"id": pid, "name": names[pid], "hours": hours}
                             for pid, hours in sorted(projects.items(), key=lambda kv: names[kv[0]].lower())],
                "other_hours": other,
            })
        result.append({"id": str(person["id"]), "name": person["name"],
                       "team_id": str(person["team_id"]) if person["team_id"] else None,
                       "weeks": person_weeks})
    return {"weeks": [m.isoformat() for m in mondays], "people": result}


def over_allocated(actor: dict, threshold: int, date_from: datetime.date,
                   date_to: datetime.date) -> dict:
    """People whose weekly total is above `threshold` in some week of the window."""
    people, by_person, mondays = _weekly_hours(actor, None, date_from, date_to)
    result = []
    for person in people:
        busy = []
        for monday in mondays:
            total = sum(a["hours_per_week"] for a in by_person[str(person["id"])] if _in_week(a, monday))
            if total > threshold:
                busy.append({"week_start": monday.isoformat(), "total_hours": total})
        if busy:
            result.append({"id": str(person["id"]), "name": person["name"], "weeks": busy})
    return {"label": "near capacity", "threshold": threshold, "people": result}


# =====================================================================
# 4. Deliverable status
# =====================================================================
def deliverable_status(actor: dict, project_id: Optional[str], status: Optional[str],
                       overdue: Optional[bool]) -> dict:
    projects = repository.visible_projects(actor["role"], str(actor["id"]), project_id=project_id)
    if project_id is not None and not projects:
        raise NotFound("Project not found.", "not_found")
    names = {str(p["id"]): p["name"] for p in projects}
    graph = _Deliverables(list(names), weeks.today())
    result = []
    for key, row in graph.rows.items():   # already ordered by due date
        if status is not None and row["status"] != status:
            continue
        if overdue is not None and graph.overdue(key) != overdue:
            continue
        pid = str(row["project_id"])
        result.append({
            "id": key, "name": row["name"], "project": {"id": pid, "name": names[pid]},
            "status": row["status"], "start_date": _iso(row["start_date"]),
            "due_date": _iso(row["due_date"]), "overdue": graph.overdue(key),
            "blocked": graph.blocked(key), "blocking": graph.blocking(key),
        })
    return {"deliverables": result}


# =====================================================================
# 6. Dependency chain
# =====================================================================
def _reachable(start: str, step: dict) -> set:
    seen, stack = set(), [start]
    while stack:
        node = stack.pop()
        for nxt in step[node]:
            if nxt not in seen:
                seen.add(nxt)
                stack.append(nxt)
    return seen


def dependency_chain(actor: dict, project_id: str, deliverable_id: Optional[str]) -> dict:
    """The project's dependency graph: nodes with depth, edges, a topological
    order and the longest chain. With deliverable_id, only that deliverable and
    everything upstream and downstream of it."""
    if not repository.visible_projects(actor["role"], str(actor["id"]), project_id=project_id):
        raise NotFound("Project not found.", "not_found")
    graph = _Deliverables([project_id], weeks.today())
    keep = set(graph.rows)
    if deliverable_id is not None:
        if deliverable_id not in graph.rows:
            raise NotFound("Deliverable not found.", "not_found")
        keep = ({deliverable_id} | _reachable(deliverable_id, graph.depends_on)
                | _reachable(deliverable_id, graph.dependents))

    def sort_key(key):
        row = graph.rows[key]
        return (row["due_date"], row["name"].lower(), key)

    parents = {k: sorted(graph.depends_on[k] & keep, key=sort_key) for k in keep}
    children = {k: sorted(graph.dependents[k] & keep, key=sort_key) for k in keep}

    # Kahn's algorithm; ties broken by due date, name, id so the order is stable.
    waiting = {k: len(parents[k]) for k in keep}
    ready = sorted((k for k in keep if waiting[k] == 0), key=sort_key)
    order = []
    while ready:
        node = ready.pop(0)
        order.append(node)
        for child in children[node]:
            waiting[child] -= 1
            if waiting[child] == 0:
                ready.append(child)
                ready.sort(key=sort_key)

    # depth = length of the longest dependency path leading to the node.
    depth, best_parent = {}, {}
    for node in order:
        depth[node] = 0
        for parent in parents[node]:
            if depth[parent] + 1 > depth[node]:
                depth[node], best_parent[node] = depth[parent] + 1, parent
    longest = []
    if order:
        deepest = max(depth.values())
        node = min((k for k in order if depth[k] == deepest), key=sort_key)
        while node is not None:
            longest.append(node)
            node = best_parent.get(node)
        longest.reverse()

    nodes = [{"id": k, "name": graph.rows[k]["name"], "status": graph.rows[k]["status"],
              "start_date": _iso(graph.rows[k]["start_date"]),
              "due_date": _iso(graph.rows[k]["due_date"]), "depth": depth[k]} for k in order]
    edges = [{"from": parent, "to": k} for k in order for parent in parents[k]]
    return {"project_id": project_id, "nodes": nodes, "edges": edges, "order": order,
            "longest_chain": longest}


# =====================================================================
# 7. Budget used vs planned
# =====================================================================
def budget_report(actor: dict, team_id: Optional[str]) -> dict:
    role = actor["role"]
    today = weeks.today()
    projects = repository.visible_projects(role, str(actor["id"]), team_id)
    money = _project_money(_project_ids(projects), today)
    project_rows = []
    for project in projects:
        entry = money[str(project["id"])]
        planned_budget = project["planned_budget"]
        # Cost fields come from salaries, so they follow MIN_AGGREGATE_GROUP.
        # The planned budget is typed in, not a salary, so it is always shown.
        hidden = budget.is_hidden(role, len(entry["people"]))
        project_rows.append({
            "id": str(project["id"]), "name": project["name"],
            "team": _ref(project, "team_id", "team_name"),
            "planned_budget": budget.money(planned_budget),
            "committed_cost": None if hidden else budget.money(entry["planned"]),
            "used_cost_to_date": None if hidden else budget.money(entry["used"]),
            "percent_used": None if hidden else budget.percent_of_budget(entry["used"], planned_budget),
            "over_budget": None if hidden else budget.over_budget(entry["planned"], planned_budget),
            "hidden_reason": budget.hidden_reason(hidden),
        })

    teams = repository.teams(role, str(actor["id"]), team_id)
    salaries = defaultdict(list)
    for row in repository.team_salaries([str(t["id"]) for t in teams]) if teams else []:
        salaries[str(row["team_id"])].append(row["salary"])
    team_rows = []
    for team in teams:
        members = salaries[str(team["id"])]
        hidden = budget.is_hidden(role, len(members))
        totals = budget.team_budget(members)
        team_rows.append({
            "id": str(team["id"]), "name": team["name"],
            "weekly": None if hidden else budget.money(totals["weekly"]),
            "yearly": None if hidden else budget.money(totals["yearly"]),
            "hidden_reason": budget.hidden_reason(hidden),
        })
    return {"projects": project_rows, "teams": team_rows}
