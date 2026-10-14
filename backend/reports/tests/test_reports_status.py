"""Reports 1, 4 and 6: project status, deliverable status and dependency chain."""

import uuid

import pytest

pytestmark = pytest.mark.integration

BASE = "/api/reports"


def sid(row):
    return str(row["id"])


# =====================================================================
# 1. Project status
# =====================================================================
def test_project_status_counts(api, world):
    resp = api("GET", f"{BASE}/project-status", as_=world["admin"])
    assert resp.status == 200
    rows = {p["name"]: p for p in resp.json["projects"]}
    assert list(rows) == ["Old", "Billing", "Lake"]
    billing = rows["Billing"]
    assert billing["deliverables"] == {"total": 4, "not_started": 2, "in_progress": 1, "done": 1,
                                       "overdue": 1, "blocked": 1}
    assert billing["percent_complete"] == 25.0
    assert billing["team"] == {"id": sid(world["platform"]), "name": "Platform"}
    assert billing["manager"] == {"id": sid(world["max"]), "name": "Max Manager"}
    assert rows["Lake"]["percent_complete"] == 0.0 and rows["Lake"]["deliverables"]["total"] == 0


@pytest.mark.parametrize("who, expected", [
    ("max", ["Old", "Billing"]), ("mia", ["Lake"]), ("e1", ["Billing", "Lake"]),
    ("e3", ["Billing"]), ("d1", ["Lake"]),
])
def test_project_status_follows_visibility(api, world, who, expected):
    resp = api("GET", f"{BASE}/project-status", as_=world[who])
    assert [p["name"] for p in resp.json["projects"]] == expected


def test_project_status_filters(api, world, factory):
    factory.project(world["data"], "Paused", status="on_hold")
    admin = world["admin"]
    by_team = api("GET", f"{BASE}/project-status", as_=admin, query=f"team_id={world['data']['id']}")
    assert [p["name"] for p in by_team.json["projects"]] == ["Lake", "Paused"]
    by_status = api("GET", f"{BASE}/project-status", as_=admin, query="status=on_hold")
    assert [p["name"] for p in by_status.json["projects"]] == ["Paused"]
    assert api("GET", f"{BASE}/project-status", as_=admin, query="status=done").status == 400
    assert api("GET", f"{BASE}/project-status", as_=admin, query="team_id=x").status == 400


def test_archived_projects_are_not_reported(api, world, factory):
    factory.project(world["platform"], "Gone", archived=True)
    assert "Gone" not in api("GET", f"{BASE}/project-status", as_=world["admin"]).text


# =====================================================================
# 4. Deliverable status
# =====================================================================
def test_deliverable_status_ordered_by_due_date(api, world):
    resp = api("GET", f"{BASE}/deliverable-status", as_=world["e2"])
    assert resp.status == 200
    rows = resp.json["deliverables"]
    assert [d["name"] for d in rows] == ["Spec", "Late", "Build", "Launch"]
    build = rows[2]
    assert build == {"id": sid(world["build"]), "name": "Build",
                     "project": {"id": sid(world["billing"]), "name": "Billing"},
                     "status": "in_progress", "start_date": "2026-11-09", "due_date": "2026-11-27",
                     "overdue": False, "blocked": False, "blocking": [sid(world["launch"])]}
    assert rows[0]["blocking"] == []          # Spec is done, so it holds nothing up
    assert rows[1]["overdue"] is True
    assert rows[3]["blocked"] is True


def test_deliverable_status_filters(api, world):
    admin = world["admin"]
    names = lambda q: [d["name"] for d in api("GET", f"{BASE}/deliverable-status", as_=admin, query=q).json["deliverables"]]  # noqa: E731
    assert names("overdue=true") == ["Late"]
    assert names("overdue=false") == ["Spec", "Build", "Launch"]
    assert names("status=done") == ["Spec"]
    assert names(f"project_id={world['lake']['id']}") == []
    assert api("GET", f"{BASE}/deliverable-status", as_=admin, query="status=late").status == 400
    assert api("GET", f"{BASE}/deliverable-status", as_=admin, query="overdue=1").status == 400


def test_deliverable_status_of_a_hidden_project_is_404(api, world):
    resp = api("GET", f"{BASE}/deliverable-status", as_=world["mia"], query=f"project_id={world['billing']['id']}")
    assert resp.status == 404
    assert api("GET", f"{BASE}/deliverable-status", as_=world["mia"]).json == {"deliverables": []}


# =====================================================================
# 6. Dependency chain
# =====================================================================
def test_dependency_chain(api, world):
    resp = api("GET", f"{BASE}/dependency-chain", as_=world["e1"], query=f"project_id={world['billing']['id']}")
    assert resp.status == 200
    body = resp.json
    spec, late, build, launch = (sid(world[k]) for k in ("spec", "late", "build", "launch"))
    assert body["project_id"] == sid(world["billing"])
    assert body["order"] == [spec, late, build, launch]
    assert {n["name"]: n["depth"] for n in body["nodes"]} == {"Spec": 0, "Late": 0, "Build": 1, "Launch": 2}
    assert body["edges"] == [{"from": spec, "to": build}, {"from": build, "to": launch}]
    assert body["longest_chain"] == [spec, build, launch]


def test_dependency_chain_around_one_deliverable(api, world, factory):
    extra = factory.deliverable(world["billing"], "Docs", start="2026-11-16", due="2026-11-30",
                                depends_on=[world["spec"]])
    resp = api("GET", f"{BASE}/dependency-chain", as_=world["max"],
               query=f"project_id={world['billing']['id']}&deliverable_id={world['build']['id']}")
    names = [n["name"] for n in resp.json["nodes"]]
    assert names == ["Spec", "Build", "Launch"]       # not Late, not Docs (a sibling)
    assert sid(extra) not in resp.text


def test_dependency_chain_errors(api, world):
    assert api("GET", f"{BASE}/dependency-chain", as_=world["admin"]).status == 400
    assert api("GET", f"{BASE}/dependency-chain", as_=world["admin"], query="project_id=x").status == 400
    resp = api("GET", f"{BASE}/dependency-chain", as_=world["d1"], query=f"project_id={world['billing']['id']}")
    assert resp.status == 404
    resp = api("GET", f"{BASE}/dependency-chain", as_=world["admin"],
               query=f"project_id={world['billing']['id']}&deliverable_id={uuid.uuid4()}")
    assert resp.status == 404


def test_dependency_chain_of_an_empty_project(api, world):
    resp = api("GET", f"{BASE}/dependency-chain", as_=world["admin"], query=f"project_id={world['lake']['id']}")
    assert resp.json == {"project_id": sid(world["lake"]), "nodes": [], "edges": [], "order": [],
                         "longest_chain": []}
