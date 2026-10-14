"""Unit tests for common/validation.py and the error shape (no database)."""

import datetime

import pytest

from common import validation as v
from common.errors import BadRequest, Conflict, NotFound

UUID = "8e799cd3-d24f-4475-9f16-78fff995c10c"


def test_error_details_are_included_only_when_given():
    assert Conflict("x", "c").to_dict() == {"error": {"code": "c", "message": "x"}}
    with_details = Conflict("x", "c", details={"weeks": []}).to_dict()
    assert with_details == {"error": {"code": "c", "message": "x", "details": {"weeks": []}}}


def test_reject_unknown_fields():
    v.reject_unknown_fields({"a": 1}, ("a", "b"))
    with pytest.raises(BadRequest) as exc:
        v.reject_unknown_fields({"secret_field": 1}, ("a",))
    assert "secret_field" not in exc.value.message


@pytest.mark.parametrize("query, expected", [({}, False), ({"f": "false"}, False), ({"f": "true"}, True)])
def test_flag(query, expected):
    assert v.flag(query, "f") is expected


@pytest.mark.parametrize("value", ["TRUE", "1", ""])
def test_flag_rejects_anything_else(value):
    with pytest.raises(BadRequest):
        v.flag({"f": value}, "f")


def test_uuids_are_canonicalised():
    assert v.parse_uuid(UUID.upper()) == UUID
    assert v.parse_uuid("nope") is None and v.parse_uuid(7) is None
    assert v.path_uuid({"id": UUID}) == UUID
    with pytest.raises(NotFound):
        v.path_uuid({"id": "nope"})
    assert v.query_uuid({}, "team_id") is None
    assert v.query_uuid({"team_id": UUID}, "team_id") == UUID
    with pytest.raises(BadRequest):
        v.query_uuid({"team_id": "x"}, "team_id")


def test_require_uuid_uses_the_given_code_for_a_non_uuid_string():
    assert v.require_uuid({"lead_id": UUID}, "lead_id") == UUID
    with pytest.raises(BadRequest) as exc:
        v.require_uuid({"lead_id": "nope"}, "lead_id", code="invalid_lead")
    assert exc.value.code == "invalid_lead"
    for body in ({}, {"lead_id": 5}):
        with pytest.raises(BadRequest) as exc:
            v.require_uuid(body, "lead_id", code="invalid_lead")
        assert exc.value.code == "bad_request"


def test_dates():
    assert v.require_date({"d": "2026-02-28"}, "d") == datetime.date(2026, 2, 28)
    assert v.query_date({}, "from") is None
    assert v.query_date({"from": "2026-01-05"}, "from") == datetime.date(2026, 1, 5)
    for bad in ("2026-02-30", "2026-2-1", "20260201", 20260201, "2026-02-01T00:00"):
        with pytest.raises(BadRequest):
            v.require_date({"d": bad}, "d")
    with pytest.raises(BadRequest):
        v.require_date({}, "d")


def test_optional_text():
    assert v.optional_text({}, "description", 10) == ""
    assert v.optional_text({"description": None}, "description", 10) == ""
    assert v.optional_text({"description": "  hi "}, "description", 10) == "hi"
    for bad in ({"description": 5}, {"description": "x" * 11}):
        with pytest.raises(BadRequest):
            v.optional_text(bad, "description", 10)


def test_require_choice():
    assert v.require_choice({"s": "active"}, "s", ("active", "planned")) == "active"
    with pytest.raises(BadRequest):
        v.require_choice({"s": "Active"}, "s", ("active", "planned"))


@pytest.mark.parametrize("value", [0, 41, 20.5, 20.0, "20", True, None])
def test_require_int_rejects(value):
    with pytest.raises(BadRequest):
        v.require_int({"h": value}, "h", 1, 40)


def test_require_int_accepts_the_bounds():
    assert v.require_int({"h": 1}, "h", 1, 40) == 1
    assert v.require_int({"h": 40}, "h", 1, 40) == 40
