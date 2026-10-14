"""Route table for the employees service: request parsing -> services -> response.

Every handler first authenticates and checks the minimum role, then validates
input, then calls services. Paths are written without the /api/employees prefix.
"""

import math
import uuid
from decimal import Decimal

import services
from common import rbac, responses, routing, validation
from common.errors import BadRequest, NotFound

SERVICE_NAME = "employees"

_MAX_TEXT = 200
_MIN_PASSWORD = 12
_MAX_SALARY = Decimal("9999999999.99")  # numeric(12, 2)
_CREATE_FIELDS = frozenset({"name", "email", "job_title", "role", "salary", "password"})
_UPDATE_FIELDS = ("name", "job_title", "role", "salary")


# =====================================================================
# Input parsing
# =====================================================================
def _employee_id(params: dict) -> str:
    """The {id} path parameter as a canonical UUID; anything else is a 404."""
    try:
        return str(uuid.UUID(params["id"]))
    except (ValueError, KeyError):
        raise NotFound("Employee not found.", code="not_found") from None


def _flag(query: dict, name: str) -> bool:
    value = query.get(name)
    if value is None or value == "false":
        return False
    if value == "true":
        return True
    raise BadRequest(f"Query parameter {name} must be true or false.")


def _reject_unknown_fields(data: dict, allowed) -> None:
    # Field names come from the client, so they are not echoed back.
    if set(data) - set(allowed):
        raise BadRequest("Request body contains unknown fields.")


def _role(data: dict) -> str:
    role = validation.require_str(data, "role", max_length=20)
    if role not in rbac.VALID_ROLES:
        raise BadRequest("Field role must be one of: admin, manager, employee.")
    return role


def _salary(data: dict) -> Decimal:
    """A JSON number from 0 to 9,999,999,999.99 with at most two decimals."""
    value = data.get("salary")
    if value is None:
        raise BadRequest("Missing required field: salary.")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise BadRequest("Field salary must be a number.")
    if isinstance(value, float) and not math.isfinite(value):
        raise BadRequest("Field salary must be a number.")
    amount = Decimal(str(value))
    if amount < 0 or amount > _MAX_SALARY:
        raise BadRequest("Field salary must be between 0 and 9999999999.99.")
    if amount != amount.quantize(Decimal("0.01")):
        raise BadRequest("Field salary must have at most two decimal places.")
    return amount.quantize(Decimal("0.01"))


def _password(data: dict) -> str:
    password = validation.require_str(data, "password", max_length=256, strip=False)
    if len(password) < _MIN_PASSWORD:
        raise BadRequest(f"Field password must be at least {_MIN_PASSWORD} characters.")
    return password


_PARSERS = {
    "name": lambda data: validation.require_str(data, "name", max_length=_MAX_TEXT),
    "job_title": lambda data: validation.require_str(data, "job_title", max_length=_MAX_TEXT),
    "role": _role,
    "salary": _salary,
}


# =====================================================================
# Handlers
# =====================================================================
def list_employees(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = rbac.authenticate_request(headers)
    rbac.require_min_role(actor, "manager")
    include_archived = _flag(query, "include_archived")
    return responses.ok({"employees": services.list_employees(actor, include_archived)})


def get_employee(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = rbac.authenticate_request(headers)
    rbac.require_min_role(actor, "employee")
    return responses.ok(services.get_employee(actor, _employee_id(params)))


def create_employee(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = rbac.authenticate_request(headers)
    rbac.require_min_role(actor, "admin")
    data = validation.require_dict(body)
    _reject_unknown_fields(data, _CREATE_FIELDS)
    fields = {name: parse(data) for name, parse in _PARSERS.items()}
    return responses.created(services.create_employee(
        actor,
        email=validation.require_email(data, "email"),
        password=_password(data),
        **fields,
    ))


def update_employee(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = rbac.authenticate_request(headers)
    rbac.require_min_role(actor, "admin")
    employee_id = _employee_id(params)
    data = validation.require_dict(body)
    _reject_unknown_fields(data, _UPDATE_FIELDS)
    if not data:
        raise BadRequest("Send at least one of: name, job_title, role, salary.")
    changes = {name: _PARSERS[name](data) for name in _UPDATE_FIELDS if name in data}
    return responses.ok(services.update_employee(actor, employee_id, changes))


def archive_employee(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = rbac.authenticate_request(headers)
    rbac.require_min_role(actor, "admin")
    return responses.ok(services.archive_employee(actor, _employee_id(params)))


ROUTES = {
    ("GET", "/"): list_employees,
    ("POST", "/"): create_employee,
    ("GET", "/{id}"): get_employee,
    ("PUT", "/{id}"): update_employee,
    ("POST", "/{id}/archive"): archive_employee,
}


def dispatch(method: str, path: str, query: dict, body: object, headers: dict) -> dict:
    """Call the handler for (method, path); unknown routes raise NotFound (404)."""
    handler, params, _ = routing.find_route(ROUTES, method, path)
    if handler is None:
        raise NotFound("Unknown route.", code="not_found")
    return handler(params, query, body, headers)
