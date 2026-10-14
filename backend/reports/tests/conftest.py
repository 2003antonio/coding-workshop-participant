"""Test helpers for the reports service. Shared fixtures (call_service,
factory, today) live in backend/conftest.py."""

import pytest
from service_loader import load_service

REPORTS = load_service("reports")


@pytest.fixture
def svc():
    return REPORTS


@pytest.fixture
def api(call_service, today):
    """api("GET", "/api/reports/...", as_=employee_row, query=...). Today is
    fixed at Wednesday 2026-11-11, so the current week starts 2026-11-09."""
    return call_service(REPORTS)


@pytest.fixture
def world(factory):
    """Max leads Platform (e1, e2, e3): projects Old (ended) and Billing.
    Mia leads Data (d1): project Lake. e1 also works on Lake (cross-team).

    Rates: e1 50/h, e2 60/h, e3 40/h, d1 45/h (salary / 2080).
    Billing deliverables: Spec (done) <- Build (in progress) <- Launch, plus Late (overdue).
    """
    w = {
        "admin": factory.employee("admin", name="Ada Admin", salary=200000),
        "max": factory.employee("manager", name="Max Manager", salary=150000),
        "mia": factory.employee("manager", name="Mia Manager", salary=140000),
        "e1": factory.employee(name="Eve One", salary=104000),
        "e2": factory.employee(name="Eli Two", salary=124800),
        "e3": factory.employee(name="Emma Three", salary=83200),
        "d1": factory.employee(name="Dan Data", salary=93600),
    }
    w["platform"] = factory.team(w["max"], "Platform", members=[w["e1"], w["e2"], w["e3"]])
    w["data"] = factory.team(w["mia"], "Data", members=[w["d1"]])
    w["old"] = factory.project(w["platform"], "Old", start="2026-10-01", end="2026-10-30")
    w["billing"] = factory.project(w["platform"], "Billing", start="2026-11-02", end="2027-03-31")
    w["lake"] = factory.project(w["data"], "Lake", start="2026-11-02", end="2027-03-31")
    w["spec"] = factory.deliverable(w["billing"], "Spec", start="2026-11-02", due="2026-11-06", status="done")
    w["build"] = factory.deliverable(w["billing"], "Build", start="2026-11-09", due="2026-11-27",
                                     status="in_progress", depends_on=[w["spec"]])
    w["launch"] = factory.deliverable(w["billing"], "Launch", start="2026-11-05", due="2026-12-04",
                                      depends_on=[w["build"]])
    w["late"] = factory.deliverable(w["billing"], "Late", start="2026-11-02", due="2026-11-10")
    factory.allocation(w["e1"], w["billing"], hours=20, start="2026-11-02", end="2026-12-18")
    factory.allocation(w["e2"], w["billing"], hours=30, start="2026-11-09", end="2026-11-20")
    factory.allocation(w["e3"], w["billing"], hours=10, start="2026-11-02", end="2026-11-06")
    factory.allocation(w["e1"], w["lake"], hours=15, start="2026-11-16", end="2026-11-20",
                       created_by=w["admin"])
    factory.allocation(w["d1"], w["lake"], hours=20, start="2026-12-01", end="2026-12-31")
    return w


def ids(*rows):
    return [str(r["id"]) for r in rows]
