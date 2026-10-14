"""Route table for the teams service: request parsing -> services -> response.

Every handler first authenticates and checks the minimum role, then validates
input, then calls services. Paths are written without the /api/teams prefix.
"""

import services
from common import rbac, responses, routing, validation
from common.errors import BadRequest, NotFound

SERVICE_NAME = "teams"

_MAX_NAME = 200
_CREATE_FIELDS = ("name", "lead_id")
_MEMBER_FIELDS = ("employee_id",)


def _name(data: dict) -> str:
    return validation.require_str(data, "name", max_length=_MAX_NAME)


def _lead_id(data: dict) -> str:
    return validation.require_uuid(data, "lead_id", code="invalid_lead")


# =====================================================================
# Handlers
# =====================================================================
def list_teams(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = rbac.authenticate_request(headers)
    rbac.require_min_role(actor, "employee")
    include_archived = validation.flag(query, "include_archived")
    return responses.ok({"teams": services.list_teams(actor, include_archived)})


def get_team(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = rbac.authenticate_request(headers)
    rbac.require_min_role(actor, "employee")
    return responses.ok(services.get_team(actor, validation.path_uuid(params)))


def team_budget(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = rbac.authenticate_request(headers)
    rbac.require_min_role(actor, "employee")
    return responses.ok(services.team_budget(actor, validation.path_uuid(params)))


def create_team(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = rbac.authenticate_request(headers)
    rbac.require_min_role(actor, "admin")
    data = validation.require_dict(body)
    validation.reject_unknown_fields(data, _CREATE_FIELDS)
    return responses.created(services.create_team(actor, _name(data), _lead_id(data)))


def update_team(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = rbac.authenticate_request(headers)
    rbac.require_min_role(actor, "admin")
    team_id = validation.path_uuid(params)
    data = validation.require_dict(body)
    validation.reject_unknown_fields(data, _CREATE_FIELDS)
    if not data:
        raise BadRequest("Send at least one of: name, lead_id.")
    changes = {}
    if "name" in data:
        changes["name"] = _name(data)
    if "lead_id" in data:
        changes["lead_id"] = _lead_id(data)
    return responses.ok(services.update_team(actor, team_id, changes))


def add_member(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = rbac.authenticate_request(headers)
    rbac.require_min_role(actor, "admin")
    team_id = validation.path_uuid(params)
    data = validation.require_dict(body)
    validation.reject_unknown_fields(data, _MEMBER_FIELDS)
    employee_id = validation.require_uuid(data, "employee_id", code="invalid_employee")
    return responses.ok(services.add_member(actor, team_id, employee_id))


def remove_member(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = rbac.authenticate_request(headers)
    rbac.require_min_role(actor, "admin")
    team_id = validation.path_uuid(params)
    employee_id = validation.path_uuid(params, "employee_id")
    return responses.ok(services.remove_member(actor, team_id, employee_id))


def archive_team(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = rbac.authenticate_request(headers)
    rbac.require_min_role(actor, "admin")
    return responses.ok(services.archive_team(actor, validation.path_uuid(params)))


ROUTES = {
    ("GET", "/"): list_teams,
    ("POST", "/"): create_team,
    ("GET", "/{id}"): get_team,
    ("PUT", "/{id}"): update_team,
    ("POST", "/{id}/members"): add_member,
    ("DELETE", "/{id}/members/{employee_id}"): remove_member,
    ("POST", "/{id}/archive"): archive_team,
    ("GET", "/{id}/budget"): team_budget,
}


def dispatch(method: str, path: str, query: dict, body: object, headers: dict) -> dict:
    """Call the handler for (method, path); unknown routes raise NotFound (404)."""
    handler, params, _ = routing.find_route(ROUTES, method, path)
    if handler is None:
        raise NotFound("Unknown route.", code="not_found")
    return handler(params, query, body, headers)
