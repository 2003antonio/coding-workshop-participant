"""Route table for the projects service: request parsing -> services -> response.

Deliverables are a sub-resource: /{id}/deliverables/... Every handler first
authenticates and checks the minimum role, then validates input, then calls
services. Paths are written without the /api/projects prefix.
"""

import services
from common import rbac, responses, routing, validation
from common.errors import BadRequest, NotFound

SERVICE_NAME = "projects"

_MAX_NAME = 200
_MAX_DESCRIPTION = 2000
_MAX_SEARCH = 100
_PROJECT_CREATE = ("team_id", "name", "description", "status", "start_date", "end_date")
_PROJECT_UPDATE = _PROJECT_CREATE
_DELIVERABLE_CREATE = ("name", "description", "start_date", "due_date", "depends_on")
_DELIVERABLE_UPDATE = ("name", "description", "start_date", "due_date", "status")


# =====================================================================
# Input parsing
# =====================================================================
def _body(body: object, allowed) -> dict:
    data = validation.require_dict(body)
    validation.reject_unknown_fields(data, allowed)
    return data


_PROJECT_PARSERS = {
    "team_id": lambda d: validation.require_uuid(d, "team_id", code="invalid_team"),
    "name": lambda d: validation.require_str(d, "name", max_length=_MAX_NAME),
    "description": lambda d: validation.optional_text(d, "description", _MAX_DESCRIPTION),
    "status": lambda d: validation.require_choice(d, "status", services.PROJECT_STATUSES),
    "start_date": lambda d: validation.require_date(d, "start_date"),
    "end_date": lambda d: validation.require_date(d, "end_date"),
}

_DELIVERABLE_PARSERS = {
    "name": _PROJECT_PARSERS["name"],
    "description": _PROJECT_PARSERS["description"],
    "status": lambda d: validation.require_choice(d, "status", services.DELIVERABLE_STATUSES),
    "start_date": _PROJECT_PARSERS["start_date"],
    "due_date": lambda d: validation.require_date(d, "due_date"),
}


def _changes(data: dict, parsers: dict, allowed) -> dict:
    if not data:
        raise BadRequest(f"Send at least one of: {', '.join(allowed)}.")
    return {name: parsers[name](data) for name in allowed if name in data}


def _depends_on(data: dict, required: bool) -> list:
    """A JSON array of deliverable ids. Strings that are not UUIDs become None,
    which services reports as invalid_dependency."""
    value = data.get("depends_on")
    if value is None:
        if required:
            raise BadRequest("Missing required field: depends_on.")
        return []
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise BadRequest("Field depends_on must be a list of ids.")
    if len(value) > services.MAX_DEPENDENCIES * 2:
        raise BadRequest("Field depends_on has too many ids.", code="invalid_dependency")
    return [validation.parse_uuid(v) for v in value]


def _search(query: dict):
    """The optional q search text: trimmed, at most 100 characters; empty means no search."""
    value = query.get("q")
    if value is None:
        return None
    value = value.strip()
    if len(value) > _MAX_SEARCH:
        raise BadRequest(f"Query parameter q must be at most {_MAX_SEARCH} characters.")
    return value or None


def _ids(params: dict) -> tuple:
    return validation.path_uuid(params), validation.path_uuid(params, "deliverable_id")


# =====================================================================
# Project handlers
# =====================================================================
def list_projects(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = rbac.authenticate_request(headers)
    rbac.require_min_role(actor, "employee")
    include_archived = validation.flag(query, "include_archived")
    team_id = validation.query_uuid(query, "team_id")
    status = query.get("status")
    if status is not None and status not in services.PROJECT_STATUSES:
        raise BadRequest("Query parameter status is not a valid status.")
    return responses.ok({"projects": services.list_projects(actor, include_archived, team_id, status,
                                                            _search(query))})


def get_project(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = rbac.authenticate_request(headers)
    rbac.require_min_role(actor, "employee")
    return responses.ok(services.get_project(actor, validation.path_uuid(params)))


def create_project(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = rbac.authenticate_request(headers)
    rbac.require_min_role(actor, "manager")
    data = _body(body, _PROJECT_CREATE)
    status = _PROJECT_PARSERS["status"](data) if "status" in data else "planned"
    return responses.created(services.create_project(
        actor,
        team_id=_PROJECT_PARSERS["team_id"](data),
        name=_PROJECT_PARSERS["name"](data),
        description=_PROJECT_PARSERS["description"](data),
        status=status,
        start_date=_PROJECT_PARSERS["start_date"](data),
        end_date=_PROJECT_PARSERS["end_date"](data),
    ))


def update_project(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = rbac.authenticate_request(headers)
    rbac.require_min_role(actor, "manager")
    project_id = validation.path_uuid(params)
    data = _body(body, _PROJECT_UPDATE)
    changes = _changes(data, _PROJECT_PARSERS, _PROJECT_UPDATE)
    return responses.ok(services.update_project(actor, project_id, changes))


def archive_project(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = rbac.authenticate_request(headers)
    rbac.require_min_role(actor, "manager")
    return responses.ok(services.archive_project(actor, validation.path_uuid(params)))


def project_budget(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = rbac.authenticate_request(headers)
    rbac.require_min_role(actor, "employee")
    return responses.ok(services.project_budget(actor, validation.path_uuid(params)))


# =====================================================================
# Deliverable handlers
# =====================================================================
def list_deliverables(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = rbac.authenticate_request(headers)
    rbac.require_min_role(actor, "employee")
    project_id = validation.path_uuid(params)
    include_archived = validation.flag(query, "include_archived")
    return responses.ok({"deliverables": services.list_deliverables(actor, project_id, include_archived)})


def get_deliverable(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = rbac.authenticate_request(headers)
    rbac.require_min_role(actor, "employee")
    return responses.ok(services.get_deliverable(actor, *_ids(params)))


def create_deliverable(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = rbac.authenticate_request(headers)
    rbac.require_min_role(actor, "manager")
    project_id = validation.path_uuid(params)
    data = _body(body, _DELIVERABLE_CREATE)
    return responses.created(services.create_deliverable(
        actor, project_id,
        name=_DELIVERABLE_PARSERS["name"](data),
        description=_DELIVERABLE_PARSERS["description"](data),
        start_date=_DELIVERABLE_PARSERS["start_date"](data),
        due_date=_DELIVERABLE_PARSERS["due_date"](data),
        depends_on=_depends_on(data, required=False),
    ))


def update_deliverable(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = rbac.authenticate_request(headers)
    rbac.require_min_role(actor, "manager")
    project_id, deliverable_id = _ids(params)
    data = _body(body, _DELIVERABLE_UPDATE)
    changes = _changes(data, _DELIVERABLE_PARSERS, _DELIVERABLE_UPDATE)
    return responses.ok(services.update_deliverable(actor, project_id, deliverable_id, changes))


def set_dependencies(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = rbac.authenticate_request(headers)
    rbac.require_min_role(actor, "manager")
    project_id, deliverable_id = _ids(params)
    data = _body(body, ("depends_on",))
    depends_on = _depends_on(data, required=True)
    return responses.ok(services.set_dependencies(actor, project_id, deliverable_id, depends_on))


def archive_deliverable(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = rbac.authenticate_request(headers)
    rbac.require_min_role(actor, "manager")
    return responses.ok(services.archive_deliverable(actor, *_ids(params)))


ROUTES = {
    ("GET", "/"): list_projects,
    ("POST", "/"): create_project,
    ("GET", "/{id}"): get_project,
    ("PUT", "/{id}"): update_project,
    ("POST", "/{id}/archive"): archive_project,
    ("GET", "/{id}/budget"): project_budget,
    ("GET", "/{id}/deliverables"): list_deliverables,
    ("POST", "/{id}/deliverables"): create_deliverable,
    ("GET", "/{id}/deliverables/{deliverable_id}"): get_deliverable,
    ("PUT", "/{id}/deliverables/{deliverable_id}"): update_deliverable,
    ("PUT", "/{id}/deliverables/{deliverable_id}/dependencies"): set_dependencies,
    ("POST", "/{id}/deliverables/{deliverable_id}/archive"): archive_deliverable,
}


def dispatch(method: str, path: str, query: dict, body: object, headers: dict) -> dict:
    """Call the handler for (method, path); unknown routes raise NotFound (404)."""
    handler, params, _ = routing.find_route(ROUTES, method, path)
    if handler is None:
        raise NotFound("Unknown route.", code="not_found")
    return handler(params, query, body, headers)
