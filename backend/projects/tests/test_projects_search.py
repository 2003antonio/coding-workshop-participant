"""GET /api/projects/?q=: search by name or description, inside visibility only."""

from urllib.parse import urlencode

import pytest

pytestmark = pytest.mark.integration

LIST = "/api/projects/"


@pytest.fixture
def searchable(world, factory):
    factory.project(world["platform"], "Discount 50% off", description="promo")
    factory.project(world["platform"], "Discount 500 off", description="promo_v2 launch")
    factory.project(world["platform"], "Payments", description="Billing for cards", status="planned")
    factory.project(world["data"], "Secret billing audit", description="data team only")
    factory.project(world["platform"], "Old billing", archived=True)
    return world


def search(api, who, **params):
    resp = api("GET", LIST, as_=who, query=urlencode(params))
    assert resp.status == 200, resp.text
    return [p["name"] for p in resp.json["projects"]]


def test_matches_name_or_description_in_any_case(api, searchable):
    assert search(api, searchable["admin"], q="BILLING") == ["Billing", "Payments", "Secret billing audit"]
    assert search(api, searchable["admin"], q="cards") == ["Payments"]


def test_wildcards_in_the_input_are_literal(api, searchable):
    assert search(api, searchable["admin"], q="50%") == ["Discount 50% off"]
    assert search(api, searchable["admin"], q="%") == ["Discount 50% off"]
    assert search(api, searchable["admin"], q="o_v") == ["Discount 500 off"]
    assert search(api, searchable["admin"], q="_") == ["Discount 500 off"]
    assert search(api, searchable["admin"], q="\\") == []


def test_combines_with_status_and_team(api, searchable):
    admin = searchable["admin"]
    assert search(api, admin, q="billing", status="planned") == ["Payments"]
    assert search(api, admin, q="billing", team_id=str(searchable["data"]["id"])) == ["Secret billing audit"]
    assert "Old billing" in search(api, admin, q="billing", include_archived="true")


@pytest.mark.parametrize("who, expected", [
    ("max", ["Billing", "Payments"]),        # not the Data team's project
    ("mia", ["Secret billing audit"]),
    ("e1", ["Billing"]),                     # only where e1 is allocated
    ("e2", []),
])
def test_search_never_reveals_a_hidden_project(api, searchable, who, expected):
    assert search(api, searchable[who], q="billing") == expected


def test_blank_q_is_no_filter(api, searchable):
    assert search(api, searchable["max"], q="   ") == search(api, searchable["max"])


def test_q_is_limited_to_100_characters(api, searchable):
    assert search(api, searchable["admin"], q="x" * 100) == []
    resp = api("GET", LIST, as_=searchable["admin"], query=urlencode({"q": "x" * 101}))
    assert resp.status == 400 and resp.code == "bad_request"


def test_sql_looking_input_is_plain_text(api, searchable, migrated_db):
    assert search(api, searchable["admin"], q="' OR 1=1 --") == []
    assert migrated_db.query_one("SELECT count(*) AS n FROM projects")["n"] == 7
