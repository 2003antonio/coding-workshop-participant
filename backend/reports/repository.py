"""Read-only database access for the reports service.

Parameterised SQL only, and SELECT only. Salaries are read in exactly two
places, project_allocations() and team_salaries(), for the budget figures;
services.py never puts an individual salary or rate in a report.
"""

import datetime
from typing import Optional

from common import db

# Which projects a caller may see (contract section 4). Takes the parameters
# (role, role, actor_id, role, actor_id); used with the projects p / teams t aliases.
_VISIBLE = (
    "(%s = 'admin' "
    " OR (%s = 'manager' AND t.lead_id = %s) "
    " OR (%s = 'employee' AND EXISTS (SELECT 1 FROM allocations va WHERE va.project_id = p.id "
    "     AND va.employee_id = %s AND va.archived_at IS NULL))) "
)


def _visible_params(role: str, actor_id: str) -> tuple:
    return (role, role, actor_id, role, actor_id)


def visible_projects(role: str, actor_id: str, team_id: Optional[str] = None,
                     status: Optional[str] = None, project_id: Optional[str] = None) -> list:
    """Active projects the caller may see, ordered by start date then name."""
    return db.query(
        "SELECT p.id, p.name, p.status, p.start_date, p.end_date, p.planned_budget, "
        "  p.team_id, t.name AS team_name, "
        "  t.lead_id AS manager_id, l.name AS manager_name "
        "FROM projects p JOIN teams t ON t.id = p.team_id JOIN employees l ON l.id = t.lead_id "
        "WHERE p.archived_at IS NULL "
        "  AND (CAST(%s AS uuid) IS NULL OR p.team_id = %s) "
        "  AND (CAST(%s AS text) IS NULL OR p.status = %s) "
        "  AND (CAST(%s AS uuid) IS NULL OR p.id = %s) "
        "  AND " + _VISIBLE
        + "ORDER BY p.start_date, lower(p.name), p.id",
        (team_id, team_id, status, status, project_id, project_id) + _visible_params(role, actor_id),
    )


def deliverables(project_ids: list) -> list:
    """Active deliverables of the given projects, ordered by due date then name."""
    return db.query(
        "SELECT id, project_id, name, status, start_date, due_date FROM deliverables "
        "WHERE project_id = ANY(CAST(%s AS uuid[])) AND archived_at IS NULL "
        "ORDER BY due_date, lower(name), id",
        (project_ids,),
    )


def dependency_edges(project_ids: list) -> list:
    """(deliverable_id, depends_on_id) pairs between active deliverables of these projects."""
    return db.query(
        "SELECT dd.deliverable_id, dd.depends_on_id FROM deliverable_dependencies dd "
        "JOIN deliverables a ON a.id = dd.deliverable_id "
        "JOIN deliverables b ON b.id = dd.depends_on_id "
        "WHERE a.project_id = ANY(CAST(%s AS uuid[])) "
        "  AND a.archived_at IS NULL AND b.archived_at IS NULL",
        (project_ids,),
    )


def project_allocations(project_ids: list) -> list:
    """Active allocations of the given projects with the person's salary (budget only)."""
    return db.query(
        "SELECT a.project_id, a.employee_id, a.hours_per_week, a.start_date, a.end_date, e.salary "
        "FROM allocations a JOIN employees e ON e.id = a.employee_id "
        "WHERE a.project_id = ANY(CAST(%s AS uuid[])) AND a.archived_at IS NULL",
        (project_ids,),
    )


def people(role: str, actor_id: str, team_id: Optional[str]) -> list:
    """Active people in the caller's scope: admin everyone, a manager the members
    of teams they lead, an employee themselves. Ordered by name."""
    return db.query(
        "SELECT e.id, e.name, e.team_id FROM employees e "
        "WHERE e.archived_at IS NULL "
        "  AND (CAST(%s AS uuid) IS NULL OR e.team_id = %s) "
        "  AND (%s = 'admin' "
        "       OR (%s = 'manager' AND EXISTS (SELECT 1 FROM teams t WHERE t.id = e.team_id "
        "           AND t.lead_id = %s AND t.archived_at IS NULL)) "
        "       OR (%s = 'employee' AND e.id = %s)) "
        "ORDER BY lower(e.name), e.id",
        (team_id, team_id, role, role, actor_id, role, actor_id),
    )


def people_allocations(employee_ids: list, date_from: datetime.date, date_to: datetime.date) -> list:
    """Active allocations of these people overlapping date_from..date_to, with project names.

    services.py shows a project's name only when the caller can see that project.
    """
    return db.query(
        "SELECT a.employee_id, a.project_id, p.name AS project_name, a.hours_per_week, "
        "  a.start_date, a.end_date "
        "FROM allocations a JOIN projects p ON p.id = a.project_id "
        "WHERE a.employee_id = ANY(CAST(%s AS uuid[])) AND a.archived_at IS NULL "
        "  AND a.start_date <= %s AND a.end_date >= %s",
        (employee_ids, date_to, date_from),
    )


def teams(role: str, actor_id: str, team_id: Optional[str]) -> list:
    """Active teams for the budget report: admin all, a manager those they lead."""
    return db.query(
        "SELECT id, name FROM teams WHERE archived_at IS NULL "
        "  AND (CAST(%s AS uuid) IS NULL OR id = %s) "
        "  AND (%s = 'admin' OR lead_id = %s) "
        "ORDER BY lower(name), id",
        (team_id, team_id, role, actor_id),
    )


def team_salaries(team_ids: list) -> list:
    """(team_id, salary) for every active member of these teams (budget only)."""
    return db.query(
        "SELECT team_id, salary FROM employees "
        "WHERE team_id = ANY(CAST(%s AS uuid[])) AND archived_at IS NULL",
        (team_ids,),
    )


# Activity (report 8): audit_log rows with the names needed for a sentence,
# resolved by joins (nothing extra is stored). Takes the parameters
# (actions, role, actor_id). The scope is the WHERE clause: admin every row;
# a manager only project, deliverable and allocation rows whose project
# belongs to a team they lead. details is selected for the services layer,
# which reads only whitelisted keys and never returns it.
_ACTIVITY_FROM = (
    "FROM audit_log a "
    "LEFT JOIN employees ae ON ae.id = a.actor_id "
    "LEFT JOIN employees emp ON a.entity_type = 'employee' AND emp.id = a.entity_id "
    "LEFT JOIN teams tm ON a.entity_type = 'team' AND tm.id = a.entity_id "
    "LEFT JOIN deliverables dl ON a.entity_type = 'deliverable' AND dl.id = a.entity_id "
    "LEFT JOIN allocations al ON a.entity_type = 'allocation' AND al.id = a.entity_id "
    "LEFT JOIN employees alemp ON alemp.id = al.employee_id "
    "LEFT JOIN projects pr ON pr.id = CASE a.entity_type "
    "  WHEN 'project' THEN a.entity_id WHEN 'deliverable' THEN dl.project_id "
    "  WHEN 'allocation' THEN al.project_id END "
    "LEFT JOIN teams pt ON pt.id = pr.team_id "
    "LEFT JOIN employees mem ON a.action IN ('team_member_added', 'team_member_removed') "
    "  AND CAST(mem.id AS text) = a.details ->> 'employee_id' "
    "WHERE a.action = ANY(CAST(%s AS text[])) "
    # People are archived, never deleted, so an actor id with no employee row only
    # happens after a demo reset: such rows are left out rather than shown as "Someone".
    "  AND (a.actor_id IS NULL OR ae.id IS NOT NULL) "
    "  AND (%s = 'admin' OR (a.entity_type IN ('project', 'deliverable', 'allocation') "
    "       AND pt.lead_id = %s)) "
)


def activity(actions: list, role: str, actor_id: str, limit: int, offset: int) -> list:
    """One page of audit rows the caller may see, newest first."""
    return db.query(
        "SELECT a.id, a.created_at, a.action, a.entity_type, a.entity_id, a.details, "
        "  a.actor_id, ae.name AS actor_name, ae.role AS actor_role, "
        "  emp.name AS employee_name, tm.name AS team_name, dl.name AS deliverable_name, "
        "  pr.name AS project_name, alemp.name AS assignee_name, mem.name AS member_name "
        + _ACTIVITY_FROM
        + "ORDER BY a.created_at DESC, a.id DESC LIMIT %s OFFSET %s",
        (list(actions), role, actor_id, limit, offset),
    )


def activity_count(actions: list, role: str, actor_id: str) -> int:
    """How many audit rows the caller may see for these actions."""
    rows = db.query("SELECT COUNT(*) AS n " + _ACTIVITY_FROM, (list(actions), role, actor_id))
    return int(rows[0]["n"])
