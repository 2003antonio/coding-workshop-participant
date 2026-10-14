"""Route table for the reports service: request parsing -> services -> response.

All reports are GET. Every handler first authenticates and checks the minimum
role, then validates the query, then calls services. Paths are written without
the /api/reports prefix.
"""

import datetime
import re

import services
from common import rbac, responses, routing, validation, weeks
from common.errors import BadRequest, NotFound

SERVICE_NAME = "reports"

PROJECT_STATUSES = ("planned", "active", "on_hold", "completed")
DELIVERABLE_STATUSES = ("not_started", "in_progress", "done")
DEFAULT_WEEKS = 12
MAX_WEEKS = 52
DEFAULT_THRESHOLD = 32


# =====================================================================
# Query parsing
# =====================================================================
def _choice(query: dict, name: str, choices) -> object:
    value = query.get(name)
    if value is not None and value not in choices:
        raise BadRequest(f"Query parameter {name} is not a valid value.")
    return value


def _optional_flag(query: dict, name: str) -> object:
    """None when absent, else true/false."""
    return None if query.get(name) is None else validation.flag(query, name)


def window(query: dict) -> tuple:
    """(from, to) dates. Defaults to the current week plus the next 11; at most
    52 weeks, and from must not be after to (else 400 invalid_range)."""
    date_from = validation.query_date(query, "from")
    date_to = validation.query_date(query, "to")
    span = datetime.timedelta(weeks=DEFAULT_WEEKS) - datetime.timedelta(days=1)
    if date_from is None and date_to is None:
        date_from = weeks.week_start(weeks.today())
    if date_to is None:
        date_to = weeks.week_start(date_from) + span
    if date_from is None:
        date_from = weeks.week_start(date_to) + datetime.timedelta(days=6) - span
    if date_from > date_to or weeks.count_weeks(date_from, date_to) > MAX_WEEKS:
        raise BadRequest(f"The date range must run forward and cover at most {MAX_WEEKS} weeks.",
                         code="invalid_range")
    return date_from, date_to


def threshold(query: dict) -> int:
    value = query.get("threshold")
    if value is None:
        return DEFAULT_THRESHOLD
    if not re.fullmatch(r"[0-9]{1,2}", value) or not 1 <= int(value) <= 40:
        raise BadRequest("Query parameter threshold must be a whole number from 1 to 40.")
    return int(value)


def _actor(headers: dict, min_role: str) -> dict:
    actor = rbac.authenticate_request(headers)
    rbac.require_min_role(actor, min_role)
    return actor


# =====================================================================
# Handlers
# =====================================================================
def project_status(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = _actor(headers, "employee")
    return responses.ok(services.project_status(
        actor, validation.query_uuid(query, "team_id"), _choice(query, "status", PROJECT_STATUSES)))


def at_risk_projects(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = _actor(headers, "manager")
    return responses.ok(services.at_risk_projects(actor))


def resource_allocation(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = _actor(headers, "employee")
    date_from, date_to = window(query)
    return responses.ok(services.resource_allocation(
        actor, validation.query_uuid(query, "team_id"), date_from, date_to))


def deliverable_status(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = _actor(headers, "employee")
    return responses.ok(services.deliverable_status(
        actor, validation.query_uuid(query, "project_id"),
        _choice(query, "status", DELIVERABLE_STATUSES), _optional_flag(query, "overdue")))


def over_allocated(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = _actor(headers, "manager")
    level = threshold(query)
    date_from, date_to = window(query)
    return responses.ok(services.over_allocated(actor, level, date_from, date_to))


def dependency_chain(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = _actor(headers, "employee")
    project_id = validation.query_uuid(query, "project_id")
    if project_id is None:
        raise BadRequest("Query parameter project_id is required.")
    return responses.ok(services.dependency_chain(
        actor, project_id, validation.query_uuid(query, "deliverable_id")))


def budget_report(params: dict, query: dict, body: object, headers: dict) -> dict:
    actor = _actor(headers, "manager")
    return responses.ok(services.budget_report(actor, validation.query_uuid(query, "team_id")))


ROUTES = {
    ("GET", "/project-status"): project_status,
    ("GET", "/at-risk-projects"): at_risk_projects,
    ("GET", "/resource-allocation"): resource_allocation,
    ("GET", "/deliverable-status"): deliverable_status,
    ("GET", "/over-allocated"): over_allocated,
    ("GET", "/dependency-chain"): dependency_chain,
    ("GET", "/budget"): budget_report,
}


def dispatch(method: str, path: str, query: dict, body: object, headers: dict) -> dict:
    """Call the handler for (method, path); unknown routes raise NotFound (404)."""
    handler, params, _ = routing.find_route(ROUTES, method, path)
    if handler is None:
        raise NotFound("Unknown route.", code="not_found")
    return handler(params, query, body, headers)
