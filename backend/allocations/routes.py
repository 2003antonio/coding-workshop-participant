"""Route table for the allocations service: request parsing -> services -> response.

Every handler first authenticates and checks the minimum role, then validates
input, then calls services. Paths are written without the /api/allocations prefix.
"""

import services
from common import rbac, responses, routing, validation
from common.errors import BadRequest, NotFound

SERVICE_NAME = "allocations"

_CREATE_FIELDS = ("employee_id", "project_id", "hours_per_week", "start_date", "end_date")
_UPDATE_FIELDS = ("hours_per_week", "start_date", "end_date")

_PARSERS = {
    "hours_per_week": lambda d: validation.require_int(d, "hours_per_week", 1,
                                                       services.MAX_HOURS_PER_WEEK),
    "start_date": lambda d: validation.require_date(d, "start_date"),
    "end_date": lambda d: validation.require_date(d, "end_date"),
}


def _body(body: object, allowed) -> dict:
    data = validation.require_dict(body)
    validation.reject_unknown_fields(data, allowed)
    return data


# =====================================================================
# Handlers
# =====================================================================
def list_allocations(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = rbac.authenticate_request(headers)
    rbac.require_min_role(actor, "employee")
    rows = services.list_allocations(
        actor,
        include_archived=validation.flag(query, "include_archived"),
        project_id=validation.query_uuid(query, "project_id"),
        employee_id=validation.query_uuid(query, "employee_id"),
        date_from=validation.query_date(query, "from"),
        date_to=validation.query_date(query, "to"),
    )
    return responses.ok({"allocations": rows})


def get_allocation(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = rbac.authenticate_request(headers)
    rbac.require_min_role(actor, "employee")
    return responses.ok(services.get_allocation(actor, validation.path_uuid(params)))


def create_allocation(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = rbac.authenticate_request(headers)
    rbac.require_min_role(actor, "manager")
    data = _body(body, _CREATE_FIELDS)
    fields = {name: parse(data) for name, parse in _PARSERS.items()}
    return responses.created(services.create_allocation(
        actor,
        employee_id=validation.require_uuid(data, "employee_id", code="invalid_employee"),
        project_id=validation.require_uuid(data, "project_id"),
        **fields,
    ))


def update_allocation(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = rbac.authenticate_request(headers)
    rbac.require_min_role(actor, "manager")
    allocation_id = validation.path_uuid(params)
    data = _body(body, _UPDATE_FIELDS)
    if not data:
        raise BadRequest("Send at least one of: hours_per_week, start_date, end_date.")
    changes = {name: _PARSERS[name](data) for name in _UPDATE_FIELDS if name in data}
    return responses.ok(services.update_allocation(actor, allocation_id, changes))


def archive_allocation(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = rbac.authenticate_request(headers)
    rbac.require_min_role(actor, "manager")
    return responses.ok(services.archive_allocation(actor, validation.path_uuid(params)))


ROUTES = {
    ("GET", "/"): list_allocations,
    ("POST", "/"): create_allocation,
    ("GET", "/{id}"): get_allocation,
    ("PUT", "/{id}"): update_allocation,
    ("POST", "/{id}/archive"): archive_allocation,
}


def dispatch(method: str, path: str, query: dict, body: object, headers: dict) -> dict:
    """Call the handler for (method, path); unknown routes raise NotFound (404)."""
    handler, params, _ = routing.find_route(ROUTES, method, path)
    if handler is None:
        raise NotFound("Unknown route.", code="not_found")
    return handler(params, query, body, headers)
