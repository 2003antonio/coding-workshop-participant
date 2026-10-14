"""Unit tests for the employees input parsers in routes.py (no database)."""

from decimal import Decimal

import pytest

from common.errors import BadRequest, NotFound


@pytest.fixture
def routes(svc):
    return svc.routes


@pytest.mark.parametrize("value, expected", [
    (0, Decimal("0.00")),
    (85000, Decimal("85000.00")),
    (85000.5, Decimal("85000.50")),
    (0.01, Decimal("0.01")),
    (9999999999.99, Decimal("9999999999.99")),
])
def test_salary_accepts_money_amounts(routes, value, expected):
    assert routes._salary({"salary": value}) == expected


@pytest.mark.parametrize("value", [
    -0.01, 10_000_000_000, 1.005, "100", True, False, None, [1], float("inf"), float("nan"),
])
def test_salary_rejects_everything_else(routes, value):
    with pytest.raises(BadRequest):
        routes._salary({"salary": value})


@pytest.mark.parametrize("query, expected", [({}, False), ({"x": "true"}, False),
                                             ({"f": "false"}, False), ({"f": "true"}, True)])
def test_flag_parses_true_and_false_only(routes, query, expected):
    assert routes._flag(query, "f") is expected


def test_employee_id_is_canonicalised_or_404(routes):
    raw = "8E799CD3D24F4475-9F16-78FFF995C10C"
    assert routes._employee_id({"id": raw}) == "8e799cd3-d24f-4475-9f16-78fff995c10c"
    with pytest.raises(NotFound):
        routes._employee_id({"id": "nope"})
    with pytest.raises(NotFound):
        routes._employee_id({})
