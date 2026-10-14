"""Team business rules: who sees which team, leads and members, archiving,
and the team budget.

routes.py has already authenticated the caller and checked the minimum role;
the rules here depend on WHICH team is being read or changed.

Visibility: an admin sees every team; a manager sees the teams they lead; an
employee sees their own team. A team the caller cannot see is a 404.
"""

from typing import Optional

import repository
from common import audit, budget, db
from common.errors import BadRequest, Conflict, Forbidden, NotFound

_NOT_FOUND = ("Team not found.", "not_found")
_LEAD_ROLES = ("manager", "admin")


def _view(row: dict, members: Optional[list] = None) -> dict:
    """The public shape of a team, built from an explicit list of keys."""
    view = {
        "id": str(row["id"]),
        "name": row["name"],
        "lead": {"id": str(row["lead_id"]), "name": row["lead_name"]},
        "member_count": row["member_count"],
        "archived_at": row["archived_at"].isoformat() if row["archived_at"] else None,
    }
    if members is not None:
        view["members"] = [
            {"id": str(m["id"]), "name": m["name"], "job_title": m["job_title"], "role": m["role"]}
            for m in members
        ]
    return view


def _full_view(team_id: str) -> dict:
    """A team with its members, as returned by GET /{id} and every write."""
    return _view(repository.find_team(team_id), repository.members(team_id))


def _can_see(actor: dict, row: Optional[dict]) -> bool:
    if row is None:
        return False
    if actor["role"] == "admin":
        return True
    if row["archived_at"] is not None:
        return False
    if actor["role"] == "manager":
        return str(row["lead_id"]) == str(actor["id"])
    return repository.employee_team_id(str(actor["id"])) == str(row["id"])


def _visible_team(actor: dict, team_id: str) -> dict:
    row = repository.find_team(team_id)
    if not _can_see(actor, row):
        raise NotFound(*_NOT_FOUND)
    return row


def _lock_active_team(team_id: str) -> dict:
    """Lock the team for a change; 404 if missing, 409 if archived."""
    team = repository.lock_team(team_id)
    if team is None:
        raise NotFound(*_NOT_FOUND)
    if team["archived_at"] is not None:
        raise Conflict("Archived teams cannot be changed.", "archived")
    return team


def _check_lead(lead_id: str, team_id: Optional[str]) -> None:
    """The lead must be an active manager or admin who is not a member of this team.

    Locks the lead's employee row, the same lock the employees service takes
    before a demotion or archive, so neither can slip past the other.
    """
    lead = repository.lock_employee(lead_id)
    if lead is None or lead["archived_at"] is not None or lead["role"] not in _LEAD_ROLES:
        raise BadRequest("The lead must be an active manager or admin.", "invalid_lead")
    if team_id is not None and lead["team_id"] is not None and str(lead["team_id"]) == team_id:
        raise Conflict("A member of a team cannot lead it; remove them first.",
                       "lead_cannot_be_member")


# =====================================================================
# Reads
# =====================================================================
def list_teams(actor: dict, include_archived: bool) -> list:
    """The teams the caller may see; archived ones only for an admin who asks."""
    role, actor_id = actor["role"], str(actor["id"])
    if include_archived and role != "admin":
        raise Forbidden()
    if role == "admin":
        rows = repository.list_teams(include_archived)
    elif role == "manager":
        rows = repository.list_teams(False, lead_id=actor_id)
    else:
        own = repository.employee_team_id(actor_id)
        rows = repository.list_teams(False, team_id=own) if own else []
    return [_view(row) for row in rows]


def get_team(actor: dict, team_id: str) -> dict:
    _visible_team(actor, team_id)
    return _full_view(team_id)


def team_budget(actor: dict, team_id: str) -> dict:
    """Yearly and weekly salary cost of the team's active members.

    Admin and the team's lead only. A lead gets nulls when the team has fewer
    than MIN_AGGREGATE_GROUP members, so no single salary can be worked out.
    """
    row = _visible_team(actor, team_id)
    if actor["role"] != "admin" and str(row["lead_id"]) != str(actor["id"]):
        raise Forbidden()
    salaries = repository.member_salaries(team_id)
    hidden = budget.is_hidden(actor["role"], len(salaries))
    totals = budget.team_budget(salaries)
    return {
        "team_id": team_id,
        "member_count": len(salaries),
        "weekly": None if hidden else budget.money(totals["weekly"]),
        "yearly": None if hidden else budget.money(totals["yearly"]),
        "hidden_reason": budget.hidden_reason(hidden),
    }


# =====================================================================
# Writes (admin only; routes.py has checked the role)
# =====================================================================
def create_team(actor: dict, name: str, lead_id: str) -> dict:
    with db.transaction():
        _check_lead(lead_id, None)
        team_id = repository.insert_team(name, lead_id)
        if team_id is None:
            raise Conflict("An active team already has that name.", "name_taken")
        audit.record("team_created", actor["id"], "team", team_id)
    return _full_view(team_id)


def update_team(actor: dict, team_id: str, changes: dict) -> dict:
    """Rename a team and/or change its lead. A new lead becomes the manager of
    every project of the team at once (the manager is derived, never stored)."""
    with db.transaction():
        team = _lock_active_team(team_id)
        current = repository.find_team(team_id)
        name = changes.get("name")
        if name == current["name"]:
            name = None
        lead_id = changes.get("lead_id")
        if lead_id == str(team["lead_id"]):
            lead_id = None
        if lead_id is not None:
            _check_lead(lead_id, team_id)
        if name is not None and repository.name_taken(name, team_id):
            raise Conflict("An active team already has that name.", "name_taken")
        if name is None and lead_id is None:
            return _full_view(team_id)
        if not repository.update_team(team_id, name, lead_id):
            raise Conflict("An active team already has that name.", "name_taken")
        if lead_id is not None:
            audit.record("team_lead_changed", actor["id"], "team", team_id)
        if name is not None:
            audit.record("team_updated", actor["id"], "team", team_id, {"fields": ["name"]})
    return _full_view(team_id)


def add_member(actor: dict, team_id: str, employee_id: str) -> dict:
    """Put an active employee on this team. Each employee is on at most one team,
    and a team's lead is never one of its members."""
    with db.transaction():
        team = _lock_active_team(team_id)
        employee = repository.lock_employee(employee_id)
        if employee is None or employee["archived_at"] is not None:
            raise BadRequest("The employee must be an active employee.", "invalid_employee")
        if str(team["lead_id"]) == employee_id:
            raise Conflict("A team's lead cannot be one of its members.", "lead_cannot_be_member")
        if employee["team_id"] is not None:
            if str(employee["team_id"]) == team_id:
                raise Conflict("That employee is already on this team.", "already_member")
            raise Conflict("That employee is on another team; remove them there first.",
                           "on_other_team")
        repository.set_employee_team(employee_id, team_id)
        audit.record("team_member_added", actor["id"], "team", team_id, {"employee_id": employee_id})
    return _full_view(team_id)


def remove_member(actor: dict, team_id: str, employee_id: str) -> dict:
    """Take a member off this team. Their allocations stay as they are."""
    with db.transaction():
        _lock_active_team(team_id)
        employee = repository.lock_employee(employee_id)
        if employee is None or str(employee["team_id"] or "") != team_id:
            raise NotFound("That employee is not a member of this team.", "not_found")
        repository.set_employee_team(employee_id, None)
        audit.record("team_member_removed", actor["id"], "team", team_id,
                     {"employee_id": employee_id})
    return _full_view(team_id)


def archive_team(actor: dict, team_id: str) -> dict:
    """Archive (never delete) a team with no active projects; its members leave it."""
    with db.transaction():
        team = repository.lock_team(team_id)
        if team is None:
            raise NotFound(*_NOT_FOUND)
        if team["archived_at"] is not None:
            raise Conflict("That team is already archived.", "already_archived")
        if repository.has_active_projects(team_id):
            raise Conflict("Archive or move the team's projects first.", "has_active_projects")
        repository.archive_team(team_id)
        audit.record("team_archived", actor["id"], "team", team_id)
    return _full_view(team_id)
