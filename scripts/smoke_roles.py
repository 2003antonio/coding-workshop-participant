"""API smoke test of the demo roles against the local dev server. LOCAL USE ONLY.

Logs in as the demo admin, marta and ken (managers), ana and hal (employees)
from seed_demo.py and checks the rules that matter most: salary privacy, the
minimum group size, the team rule, the 40-hour rule, dependency loops, the
start rule, project visibility, the budget report, search and archiving.
Prints one PASS or FAIL line per check with a plain-language reason.

Needs the dev server (scripts/dev_server.py, port 3001) and a database seeded
with scripts/seed_demo.py. Standard library only.

Secrets: passwords come from DEMO_*_PASSWORD (environment or .env.local) and
are only ever sent to the local server. Each account gets one login attempt,
so a wrong password cannot lock it. Neither passwords nor tokens are printed:
every line is scrubbed of them before it is written.

Data: demo records are only read. Writes that the rules must refuse are aimed
at demo records, and anything the server wrongly accepts is archived straight
away. Checks that have to change data use their own records named
"smoke <time> ..." (a team led by ken with hal as its only member for the
length of check 2, and a Platform project with three deliverables and one
allocation) and archive them before the run ends. Nothing is ever deleted, so
each run leaves those archived records behind (it says so on its last line);
scripts/seed_demo.py --reset starts the demo clean again.

Usage (repo root):
    .venv/bin/python scripts/smoke_roles.py              (Linux / macOS)
    .venv/Scripts/python.exe scripts/smoke_roles.py      (Windows)
Exit code: 0 all passed, 1 some check failed, 2 could not run.
"""

import datetime
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)

from local_env import load_local_env  # noqa: E402

BASE_URL = "http://127.0.0.1:3001"
DOMAIN = "acme-demo.test"
# Demo account -> (expected role, the variable holding that role's password).
ACCOUNTS = {
    "admin": ("admin", "DEMO_ADMIN_PASSWORD"),
    "marta": ("manager", "DEMO_MANAGER_PASSWORD"),
    "ken": ("manager", "DEMO_MANAGER_PASSWORD"),
    "ana": ("employee", "DEMO_EMPLOYEE_PASSWORD"),
    "hal": ("employee", "DEMO_EMPLOYEE_PASSWORD"),
}
NON_ADMINS = ("marta", "ken", "ana", "hal")
HIDDEN = "below_min_group"
# Keys only an admin may receive: salary, hourly rate, and the per-person
# figures that give a rate away (allocation weekly_cost, project budget lines).
_ADMIN_ONLY_KEY = re.compile(r"salary|(^|_)rate($|_)|^weekly_cost$|^lines$")
# Report 7 project rows carry id, name and these seven fields.
BUDGET_FIELDS = ("team", "planned_budget", "committed_cost", "used_cost_to_date",
                 "percent_used", "over_budget", "hidden_reason")
COST_FIELDS = ("committed_cost", "used_cost_to_date", "percent_used", "over_budget")
_UNKNOWN_ID = "00000000-0000-4000-8000-000000000000"

_SECRETS: set = set()
RESPONSES: list = []  # (account, method, path, status, body) of every call made


# =====================================================================
# Output, HTTP and sessions
# =====================================================================
def say(text: str = "") -> None:
    """Print a line with every password and token replaced."""
    for secret in _SECRETS:
        text = text.replace(secret, "[redacted]")
    print(text)


def _request(account: str, method: str, path: str, token: Optional[str] = None,
             body: Optional[object] = None) -> tuple:
    """Send one request; returns (status, parsed JSON body or None). 4xx/5xx do not raise."""
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(BASE_URL + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            status, raw = resp.status, resp.read()
    except urllib.error.HTTPError as err:
        status, raw = err.code, err.read()
    try:
        payload = json.loads(raw) if raw else None
    except ValueError:
        payload = raw.decode("utf-8", "replace")
    RESPONSES.append((account, method, path, status, payload))
    return status, payload


class Session:
    """One logged-in demo account."""

    def __init__(self, key: str) -> None:
        self.key = key
        self.token: Optional[str] = None
        self.refresh_token: Optional[str] = None
        self.user: dict = {}

    def login(self, password: str) -> tuple:
        status, body = _request(self.key, "POST", "/api/auth/login",
                                body={"email": f"{self.key}@{DOMAIN}", "password": password})
        if status == 200:
            self.token, self.refresh_token = body["access_token"], body["refresh_token"]
            _SECRETS.update((self.token, self.refresh_token))
            self.user = body.get("user") or {}
        return status, body

    def logout(self) -> None:
        if self.refresh_token:
            _request(self.key, "POST", "/api/auth/logout",
                     body={"refresh_token": self.refresh_token})

    def get(self, path: str) -> tuple:
        return _request(self.key, "GET", path, self.token)

    def post(self, path: str, body: Optional[object] = None) -> tuple:
        return _request(self.key, "POST", path, self.token, body)

    def put(self, path: str, body: object) -> tuple:
        return _request(self.key, "PUT", path, self.token, body)

    def delete(self, path: str) -> tuple:
        return _request(self.key, "DELETE", path, self.token)


# =====================================================================
# Check helpers
# =====================================================================
class Fail(Exception):
    """A check did not hold; the message is the plain-language reason."""


class CannotRun(Exception):
    """The smoke test cannot start (server down, login failed, demo data missing)."""


def ensure(condition: object, reason: str) -> None:
    if not condition:
        raise Fail(reason)


def code_of(body: object) -> str:
    if isinstance(body, dict) and isinstance(body.get("error"), dict):
        return str(body["error"].get("code"))
    return "-"


def details_of(body: object) -> dict:
    if isinstance(body, dict) and isinstance(body.get("error"), dict):
        return body["error"].get("details") or {}
    return {}


def message_of(body: object) -> str:
    if isinstance(body, dict) and isinstance(body.get("error"), dict):
        return str(body["error"].get("message"))
    return ""


def got(status: int, body: object) -> str:
    """A response summed up as '409 over_allocated' or '200'."""
    return f"{status} {code_of(body)}" if status >= 400 else str(status)


def expect(result: tuple, status: int, what: str, code: Optional[str] = None) -> object:
    """The body of `result` if it has the wanted status (and error code); else Fail."""
    got_status, body = result
    want = f"{status} {code}" if code else str(status)
    ensure(got_status == status and (code is None or code_of(body) == code),
           f"{what}: expected {want}, got {got(got_status, body)}")
    return body


def is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def week_starts(start: datetime.date, end: datetime.date) -> list:
    """The Monday of every ISO week the range touches."""
    monday = start - datetime.timedelta(days=start.weekday())
    mondays = []
    while monday <= end:
        mondays.append(monday)
        monday += datetime.timedelta(days=7)
    return mondays


def people_text(n: int) -> str:
    return f"{n} person" if n == 1 else f"{n} people"


def assert_hidden(body: dict, fields: tuple, what: str) -> None:
    shown = [field for field in fields if body.get(field) is not None]
    ensure(body.get("hidden_reason") == HIDDEN and not shown,
           f"{what}: expected hidden_reason {HIDDEN} with {', '.join(fields)} null; got "
           f"hidden_reason={body.get('hidden_reason')!r}"
           + (f" and numbers in {', '.join(shown)}" if shown else ""))


class Demo:
    """The logged-in sessions and the demo records, looked up as admin."""

    def __init__(self, sessions: dict) -> None:
        self.s = sessions
        self.today = datetime.datetime.now(datetime.timezone.utc).date()
        self.monday = self.today - datetime.timedelta(days=self.today.weekday())
        self.stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
        admin = sessions["admin"]
        status, body = admin.get("/api/employees/")
        if status != 200:
            raise CannotRun(f"admin could not list employees ({got(status, body)})")
        self.employees = {e["email"].split("@")[0]: e for e in body["employees"]}
        self.teams = {t["name"]: t for t in admin.get("/api/teams/")[1]["teams"]}
        self.projects = {p["name"]: p for p in admin.get("/api/projects/")[1]["projects"]}
        self.allocations = admin.get("/api/allocations/")[1]["allocations"]
        missing = ([k for k in ACCOUNTS if k not in self.employees]
                   + [t for t in ("Platform", "Data") if t not in self.teams]
                   + [p for p in ("Billing v2", "Mobile app", "Data lake") if p not in self.projects])
        if missing:
            raise CannotRun("demo data missing (" + ", ".join(missing)
                            + "); run scripts/seed_demo.py")
        self.deliverables = {
            p["id"]: admin.get(f"/api/projects/{p['id']}/deliverables/")[1]["deliverables"]
            for p in self.projects.values()}
        self.scratch: Optional[dict] = None  # the smoke project, made on first use
        self.scratch_archived = False
        self.small_team: Optional[dict] = None
        self.small_team_archived = False
        self.notes: list = []  # cleanup problems, printed at the end

    def day(self, offset: int) -> str:
        """This week's Monday plus `offset` days, as YYYY-MM-DD."""
        return (self.monday + datetime.timedelta(days=offset)).isoformat()

    def eid(self, key: str) -> str:
        return self.employees[key]["id"]

    def pid(self, name: str) -> str:
        return self.projects[name]["id"]


def scratch_project(demo: Demo) -> dict:
    """The smoke project on Platform, made by marta, with deliverables A <- B <- C."""
    if demo.scratch:
        return demo.scratch
    marta = demo.s["marta"]
    project = expect(marta.post("/api/projects/", {
        "team_id": demo.teams["Platform"]["id"], "name": f"smoke {demo.stamp} project",
        "description": "Made by scripts/smoke_roles.py; archived when the run ends.",
        "start_date": demo.day(0), "end_date": demo.day(60)}), 201,
        "marta creates the smoke project")
    demo.scratch = {"project": project, "deliverables": {}, "names": {}}
    previous: list = []
    for i, label in enumerate("ABC"):
        deliverable = expect(marta.post(f"/api/projects/{project['id']}/deliverables/", {
            "name": f"smoke step {label}", "start_date": demo.day(7 * i),
            "due_date": demo.day(7 * i + 6), "depends_on": previous}), 201,
            f"marta creates smoke step {label}")
        demo.scratch["deliverables"][label] = deliverable["id"]
        demo.scratch["names"][deliverable["id"]] = label
        previous = [deliverable["id"]]
    return demo.scratch


def archive_allocation(demo: Demo, allocation: object) -> None:
    """Undo an allocation the server should have refused."""
    if isinstance(allocation, dict) and allocation.get("id"):
        status, body = demo.s["admin"].post(f"/api/allocations/{allocation['id']}/archive")
        if status != 200:
            demo.notes.append(f"could not archive a wrongly created allocation ({got(status, body)})")


def retire_small_team(demo: Demo) -> None:
    """Take hal off the small smoke team and archive it."""
    if not demo.small_team or demo.small_team_archived:
        return
    admin, team_id = demo.s["admin"], demo.small_team["id"]
    admin.delete(f"/api/teams/{team_id}/members/{demo.eid('hal')}")  # 404 if never added
    status, body = admin.post(f"/api/teams/{team_id}/archive")
    if status == 200:
        demo.small_team_archived = True
    else:
        demo.notes.append(f"could not archive the small smoke team ({got(status, body)})")


# =====================================================================
# The checks; each returns its PASS reason or raises Fail
# =====================================================================
def check_salary_privacy(demo: Demo) -> str:
    """1. Only admin sees salary and rates; scans every response this run got."""
    admin = demo.s["admin"]
    employees = list(demo.employees.values())
    ensure(all(is_number(e.get("salary")) for e in employees),
           "admin's employee list lacks a salary on some employees")
    ensure(demo.allocations and all("hourly_rate" in a and "weekly_cost" in a
                                    for a in demo.allocations),
           "admin's allocations lack hourly_rate / weekly_cost")
    budget = expect(admin.get(f"/api/projects/{demo.pid('Billing v2')}/budget"), 200,
                    "admin reads the Billing v2 budget")
    lines = budget.get("lines") or []
    ensure(lines and all("hourly_rate" in line for line in lines),
           "admin's Billing v2 budget has no per-person lines with hourly_rate")

    for key in NON_ADMINS:
        sweep(demo, demo.s[key])
    salaries = {float(e["salary"]) for e in employees}
    leaks, scanned = [], 0
    for account, method, path, _, body in RESPONSES:
        if account == "admin":
            continue
        scanned += 1
        for where, problem in find_leaks(body, salaries):
            leaks.append(f"{account} {method} {path} -> {where} ({problem})")
    ensure(not leaks, f"{len(leaks)} leak(s), e.g. " + "; ".join(leaks[:4]))
    return (f"admin sees salary on all {len(employees)} employees and hourly_rate on "
            f"{len(demo.allocations)} allocations and {len(lines)} Billing v2 budget lines; "
            f"{scanned} responses to marta, ken, ana and hal (every call this run, errors "
            f"included) carry no salary or rate field and no salary figure")


def sweep(demo: Demo, session: Session) -> None:
    """GET every endpoint as `session`, including records it should not see."""
    paths = ["/api/auth/me", "/api/employees/", "/api/employees/?include_archived=true",
             "/api/teams/", "/api/projects/", "/api/projects/?include_archived=true",
             "/api/allocations/", "/api/allocations/?include_archived=true"]
    paths += [f"/api/reports/{name}" for name in (
        "project-status", "at-risk-projects", "resource-allocation", "deliverable-status",
        "over-allocated", "budget")]
    paths += [f"/api/employees/{e['id']}" for e in demo.employees.values()]
    for team in demo.teams.values():
        paths += [f"/api/teams/{team['id']}", f"/api/teams/{team['id']}/budget"]
    projects = list(demo.projects.values()) + ([demo.scratch["project"]] if demo.scratch else [])
    for project in projects:
        pid = project["id"]
        paths += [f"/api/projects/{pid}", f"/api/projects/{pid}/budget",
                  f"/api/projects/{pid}/deliverables/",
                  f"/api/reports/dependency-chain?project_id={pid}",
                  f"/api/reports/deliverable-status?project_id={pid}"]
        paths += [f"/api/projects/{pid}/deliverables/{d['id']}"
                  for d in demo.deliverables.get(pid, [])]
    paths += [f"/api/allocations/{a['id']}" for a in demo.allocations]
    for path in paths:
        session.get(path)


def find_leaks(body: object, salaries: set, where: str = "body") -> list:
    """(location, problem) for every admin-only key or salary figure in `body`."""
    found = []
    if isinstance(body, dict):
        for key, value in body.items():
            if _ADMIN_ONLY_KEY.search(str(key)):
                found.append((f"{where}.{key}", "admin-only field"))
            found += find_leaks(value, salaries, f"{where}.{key}")
    elif isinstance(body, list):
        for i, value in enumerate(body):
            found += find_leaks(value, salaries, f"{where}[{i}]")
    elif is_number(body) and float(body) in salaries:
        found.append((where, "equals someone's salary"))
    return found


def check_small_group_hidden(demo: Demo) -> str:
    """2. Groups under 3 people show hidden_reason below_min_group to a manager."""
    admin, marta, ken = demo.s["admin"], demo.s["marta"], demo.s["ken"]
    mobile, billing = demo.pid("Mobile app"), demo.pid("Billing v2")
    budget = expect(marta.get(f"/api/projects/{mobile}/budget"), 200,
                    "marta reads the Mobile app budget")
    people = budget.get("allocated_people")
    ensure(is_number(people) and people < 3,
           f"setup: Mobile app should have under 3 people, its budget says {people!r}")
    assert_hidden(budget, COST_FIELDS, f"marta's Mobile app budget ({people_text(people)})")
    ensure(budget.get("planned_budget") is not None,
           "marta's Mobile app budget hides planned_budget, which is typed in and stays visible")
    control = expect(marta.get(f"/api/projects/{billing}/budget"), 200,
                     "marta reads the Billing v2 budget")
    ensure(control.get("hidden_reason") is None and is_number(control.get("committed_cost")),
           "marta's Billing v2 budget (4 people) should show numbers, got hidden_reason="
           f"{control.get('hidden_reason')!r}")
    report = expect(marta.get("/api/reports/budget"), 200, "marta reads the budget report")
    row = next((r for r in report.get("projects", []) if r.get("id") == mobile), None)
    ensure(row, "Mobile app is missing from marta's budget report")
    assert_hidden(row, COST_FIELDS, "Mobile app row in marta's budget report")

    # Neither demo team is under 3 members, so make one: led by ken, hal its only member.
    demo.small_team = expect(admin.post("/api/teams/", {
        "name": f"smoke {demo.stamp} small team", "lead_id": demo.eid("ken")}), 201,
        "admin creates the small smoke team")
    team_id = demo.small_team["id"]
    try:
        expect(admin.post(f"/api/teams/{team_id}/members", {"employee_id": demo.eid("hal")}),
               200, "admin adds hal to the small smoke team")
        team_budget = expect(ken.get(f"/api/teams/{team_id}/budget"), 200,
                             "ken reads the small team's budget")
        assert_hidden(team_budget, ("weekly", "yearly"), "ken's budget for a 1-member team")
        report = expect(ken.get("/api/reports/budget"), 200, "ken reads the budget report")
        team_row = next((t for t in report.get("teams", []) if t.get("id") == team_id), None)
        ensure(team_row, "the small team is missing from ken's budget report")
        assert_hidden(team_row, ("weekly", "yearly"), "small team row in ken's budget report")
        as_admin = expect(admin.get(f"/api/teams/{team_id}/budget"), 200,
                          "admin reads the small team's budget")
        ensure(is_number(as_admin.get("yearly")) and as_admin.get("hidden_reason") is None,
               "admin should still get numbers for the small team")
        data_team = expect(ken.get(f"/api/teams/{demo.teams['Data']['id']}/budget"), 200,
                           "ken reads the Data team budget")
        ensure(data_team.get("hidden_reason") is None and is_number(data_team.get("yearly")),
               "ken's Data team budget (3 members) should show numbers")
    finally:
        retire_small_team(demo)
    return (f"marta gets hidden_reason below_min_group and null costs for Mobile app "
            f"({people_text(people)}) on its budget and its report row, planned budget still shown; "
            f"ken gets below_min_group for a 1-member team (budget and report); groups of 3+ "
            f"and admin get numbers")


def check_team_rule(demo: Demo) -> str:
    """3. marta cannot assign someone from another team to her team's project."""
    marta, billing = demo.s["marta"], demo.pid("Billing v2")
    for key, why in (("eli", "on the Data team"), ("hal", "on no team")):
        status, body = marta.post("/api/allocations/", {
            "employee_id": demo.eid(key), "project_id": billing, "hours_per_week": 2,
            "start_date": demo.day(7), "end_date": demo.day(13)})
        if status == 201:
            archive_allocation(demo, body)
            raise Fail(f"marta was allowed to assign {key} ({why}) to Billing v2 "
                       "(the allocation has been archived again)")
        ensure(status == 403 and code_of(body) == "forbidden",
               f"marta assigning {key} ({why}) to Billing v2: expected 403 forbidden, "
               f"got {got(status, body)}")
    scratch = scratch_project(demo)
    allocation = expect(marta.post("/api/allocations/", {
        "employee_id": demo.eid("di"), "project_id": scratch["project"]["id"],
        "hours_per_week": 2, "start_date": demo.day(7), "end_date": demo.day(13)}), 201,
        "control: marta assigns di (Platform) to the Platform smoke project")
    scratch["allocation"] = allocation["id"]
    return ("marta gets 403 forbidden assigning eli (Data team) or hal (no team) to Billing v2; "
            "as a control, marta can still assign di from Platform")


def check_forty_hours(demo: Demo) -> str:
    """4. Over 40 h/week across projects is refused, naming the weeks."""
    bo, hours = demo.eid("bo"), 25
    start = demo.monday + datetime.timedelta(days=14)
    end = start + datetime.timedelta(days=13)
    existing = [a for a in demo.allocations if a["employee"]["id"] == bo]
    expected = []
    for monday in week_starts(start, end):
        sunday = monday + datetime.timedelta(days=6)
        total = hours + sum(a["hours_per_week"] for a in existing
                            if a["start_date"] <= sunday.isoformat()
                            and a["end_date"] >= monday.isoformat())
        if total > 40:
            expected.append({"week_start": monday.isoformat(), "hours": total})
    ensure(expected, "setup: bo's demo allocations no longer reach 40 h with 25 more; reseed")
    status, body = demo.s["marta"].post("/api/allocations/", {
        "employee_id": bo, "project_id": demo.pid("Mobile app"), "hours_per_week": hours,
        "start_date": start.isoformat(), "end_date": end.isoformat()})
    if status == 201:
        archive_allocation(demo, body)
        raise Fail("marta was allowed to put bo over 40 h (archived again)")
    ensure(status == 409 and code_of(body) == "over_allocated",
           f"25 h more for bo on Mobile app: expected 409 over_allocated, got {got(status, body)}")
    weeks = details_of(body).get("weeks")
    named = ", ".join(f"{w['week_start']} ({w['hours']} h)" for w in expected)
    ensure(weeks == expected, f"refused, but details.weeks is {weeks!r}; expected {named}")
    message = message_of(body)
    note = ("" if all(w["week_start"] in message for w in expected)
            else f"; note: the message text is only \"{message}\", the weeks are in "
                 "error.details.weeks")
    return f"25 h for bo on Mobile app on top of Billing v2 is refused (409 over_allocated) " \
           f"naming the weeks {named}{note}"


def check_dependency_cycle(demo: Demo) -> str:
    """5. A dependency loop is refused and the loop is named."""
    scratch, marta = scratch_project(demo), demo.s["marta"]
    ids, names, pid = scratch["deliverables"], scratch["names"], scratch["project"]["id"]
    base = f"/api/projects/{pid}/deliverables/{ids['A']}"
    status, body = marta.put(f"{base}/dependencies", {"depends_on": [ids["C"]]})
    if status == 200:
        marta.put(f"{base}/dependencies", {"depends_on": []})
        raise Fail("the loop A -> C -> B -> A was accepted (undone again)")
    ensure(status == 409 and code_of(body) == "dependency_cycle",
           f"making A depend on C (C -> B -> A): expected 409 dependency_cycle, "
           f"got {got(status, body)}")
    cycle = details_of(body).get("cycle")
    ensure(cycle == [ids["A"], ids["C"], ids["B"]],
           "refused, but details.cycle is "
           + (" -> ".join(names.get(i, "?") for i in cycle) if isinstance(cycle, list)
              else repr(cycle)) + "; expected A -> C -> B")
    after = expect(marta.get(base), 200, "marta re-reads step A")
    ensure(after.get("depends_on") == [], "the refused loop was written anyway")
    message = message_of(body)
    note = ("" if "smoke step" in message
            else f"; note: the message text is only \"{message}\", the loop is in "
                 "error.details.cycle as ids, not names")
    return ("making A depend on C is refused (409 dependency_cycle) with the loop "
            f"A -> C -> B -> A in order; nothing was written{note}")


def check_start_rule(demo: Demo) -> str:
    """6. A deliverable cannot start until its dependencies are done."""
    scratch, marta = scratch_project(demo), demo.s["marta"]
    ids, pid = scratch["deliverables"], scratch["project"]["id"]

    def set_status(label: str, status: str) -> tuple:
        return marta.put(f"/api/projects/{pid}/deliverables/{ids[label]}", {"status": status})

    status, body = set_status("B", "in_progress")
    ensure(status != 200, "step B was started while step A (its dependency) was not done")
    ensure(status == 409 and code_of(body) == "dependencies_not_done",
           f"starting B before A is done: expected 409 dependencies_not_done, got {got(status, body)}")
    ensure(details_of(body).get("pending") == [ids["A"]],
           f"refused, but details.pending is {details_of(body).get('pending')!r}; expected [A]")
    expect(set_status("A", "in_progress"), 200, "starting A (no dependencies)")
    expect(set_status("A", "done"), 200, "finishing A")
    expect(set_status("B", "in_progress"), 200, "starting B once A is done")
    status, body = set_status("C", "done")
    ensure(status == 409 and code_of(body) == "dependencies_not_done"
           and details_of(body).get("pending") == [ids["B"]],
           f"finishing C while B is in progress: expected 409 dependencies_not_done "
           f"pending [B], got {got(status, body)}")
    return ("B is refused while A is not done (409 dependencies_not_done, pending = A); "
            "once A is done B starts; C is refused while B is still in progress")


def check_employee_visibility(demo: Demo) -> str:
    """7. An employee sees only projects they are allocated to; others are 404."""
    ana, ana_id = demo.s["ana"], demo.eid("ana")
    expected = {a["project"]["id"]: a["project"]["name"]
                for a in demo.allocations if a["employee"]["id"] == ana_id}
    body = expect(ana.get("/api/projects/"), 200, "ana lists projects")
    seen = {p["id"]: p["name"] for p in body["projects"]}
    ensure(set(seen) == set(expected),
           f"ana sees {sorted(seen.values())} but is allocated to {sorted(expected.values())}")
    unseen = [p for p in demo.projects.values() if p["id"] not in expected]
    ensure(unseen, "setup: ana is allocated to every demo project, nothing to hide")
    unknown = ana.get(f"/api/projects/{_UNKNOWN_ID}")
    ensure(unknown[0] == 404, f"a made-up project id gave {got(*unknown)}, expected 404")
    for project in unseen:
        pid = project["id"]
        for path in (f"/api/projects/{pid}", f"/api/projects/{pid}/deliverables/",
                     f"/api/reports/deliverable-status?project_id={pid}",
                     f"/api/reports/dependency-chain?project_id={pid}"):
            status, body = ana.get(path)
            ensure(status == 404 and code_of(body) == code_of(unknown[1]),
                   f"ana GET {path.replace(pid, '<' + project['name'] + '>')} gave "
                   f"{got(status, body)}, expected 404 like a made-up id")
    allocations = expect(ana.get("/api/allocations/"), 200, "ana lists allocations")["allocations"]
    ensure(all(a["employee"]["id"] == ana_id for a in allocations),
           "ana's allocation list includes other people")
    return (f"ana sees exactly the {len(expected)} projects ana is allocated to "
            f"({', '.join(sorted(expected.values()))}); "
            f"{', '.join(p['name'] for p in unseen)} {'gives' if len(unseen) == 1 else 'give'} "
            f"404 (project, deliverables, reports), "
            f"the same as a made-up id; allocations list only ana's own")


def check_hal_empty(demo: Demo) -> str:
    """8. hal (expected to have no allocations) gets empty lists, not errors."""
    hal = demo.s["hal"]
    counts = {}
    for path, key in (("/api/teams/", "teams"), ("/api/projects/", "projects"),
                      ("/api/allocations/", "allocations"),
                      ("/api/reports/project-status", "projects"),
                      ("/api/reports/deliverable-status", "deliverables")):
        status, body = hal.get(path)
        ensure(status == 200 and isinstance(body, dict) and isinstance(body.get(key), list),
               f"hal GET {path} gave {got(status, body)}, not a list")
        counts[path] = len(body[key])
    if any(counts.values()):
        own = [a for a in demo.allocations if a["employee"]["id"] == demo.eid("hal")]
        found = ", ".join(f"{path} {n}" for path, n in counts.items() if n)
        raise Fail(f"no errors, but not empty ({found}): the demo data gives hal "
                   + (", ".join(f"{a['hours_per_week']} h/week on {a['project']['name']} "
                                f"from {a['start_date']}" for a in own) or "visible records")
                   + ", so 'hal has no allocations' does not hold in this data")
    return "teams, projects, allocations and the project / deliverable reports are all empty lists (200)"


def check_budget_report(demo: Demo) -> str:
    """9. The budget report has all its fields and Billing v2 is over budget."""
    admin = demo.s["admin"]
    for key in ("admin", "marta"):
        report = expect(demo.s[key].get("/api/reports/budget"), 200,
                        f"{key} reads the budget report")
        rows = report.get("projects") or []
        ensure(rows, f"{key}'s budget report has no project rows")
        missing = {r.get("name"): [f for f in ("id", "name") + BUDGET_FIELDS if f not in r]
                   for r in rows}
        missing = {name: fields for name, fields in missing.items() if fields}
        ensure(not missing, f"{key}'s budget report rows lack fields: {missing}")
        teams = report.get("teams")
        ensure(isinstance(teams, list) and all(
            all(f in t for f in ("id", "name", "weekly", "yearly", "hidden_reason")) for t in teams),
            f"{key}'s budget report teams part is missing or incomplete")
        if key == "admin":
            admin_rows = rows
    ensure(all(r["hidden_reason"] is None and is_number(r["committed_cost"]) for r in admin_rows),
           "admin's budget report hides costs on some rows")
    row = next((r for r in admin_rows if r["name"] == "Billing v2"), None)
    ensure(row, "Billing v2 is missing from admin's budget report")
    ensure(row["over_budget"] is True,
           f"Billing v2 over_budget is {row['over_budget']!r} (committed {row['committed_cost']}, "
           f"planned {row['planned_budget']})")
    ensure(row["committed_cost"] > row["planned_budget"],
           "Billing v2 is flagged over budget but committed cost is not above the planned budget")
    panel = expect(admin.get(f"/api/projects/{row['id']}/budget"), 200,
                   "admin reads the Billing v2 budget")
    ensure(panel.get("over_budget") is True and panel.get("committed_cost") == row["committed_cost"],
           f"the Billing v2 budget panel disagrees with the report (over_budget "
           f"{panel.get('over_budget')!r}, committed {panel.get('committed_cost')!r})")
    return (f"all 7 fields ({', '.join(BUDGET_FIELDS)}) on every project row for admin and "
            f"marta; Billing v2: committed {row['committed_cost']:.2f} > planned "
            f"{row['planned_budget']:.2f}, over_budget true, {row['percent_used']}% used; "
            f"the project's own budget agrees")


def check_search(demo: Demo) -> str:
    """10. GET /api/projects/?q= searches name and description."""
    admin, ana = demo.s["admin"], demo.s["ana"]
    visible = {
        "admin": expect(admin.get("/api/projects/"), 200, "admin lists projects")["projects"],
        "ana": expect(ana.get("/api/projects/"), 200, "ana lists projects")["projects"],
    }

    def matches(q: str, projects: list) -> list:
        needle = q.strip().lower()
        return sorted(p["name"] for p in projects if needle in p["name"].lower()
                      or needle in (p.get("description") or "").lower())

    for session, q in ((admin, "billing"), (admin, "BILLING"), (admin, "  lake "),
                       (admin, "zzz-no-such-project"), (admin, "%"), (admin, "_"),
                       (ana, "billing"), (ana, "lake")):
        body = expect(session.get("/api/projects/?" + urllib.parse.urlencode({"q": q})), 200,
                      f"{session.key} searching q={q!r}")
        names, want = sorted(p["name"] for p in body["projects"]), matches(q, visible[session.key])
        ensure(names == want, f"{session.key} searching q={q!r} got {names}, expected {want}")
    expect(admin.get("/api/projects/?q=" + "x" * 101), 400, "a 101-character search")
    return ("q matches name or description in any case, trimmed (billing, BILLING, '  lake '); "
            "% and _ are literal; no match is []; 101 characters is 400; ana searching "
            "'lake' gets [] (search never widens what ana can see)")


def check_archive(demo: Demo) -> str:
    """11. Archiving works and nothing is hard-deleted."""
    admin, marta, ana = demo.s["admin"], demo.s["marta"], demo.s["ana"]
    scratch = scratch_project(demo)
    pid = scratch["project"]["id"]
    status, body = ana.post(f"/api/projects/{pid}/archive")
    ensure(status == 403, f"ana (employee) archiving a project: expected 403, got {got(status, body)}")
    archived = expect(marta.post(f"/api/projects/{pid}/archive"), 200,
                      "marta archives the smoke project")
    demo.scratch_archived = True
    ensure(archived.get("archived_at"), "archive answered 200 but archived_at is empty")
    expect(marta.post(f"/api/projects/{pid}/archive"), 409, "archiving it twice", "already_archived")
    listed = [p["id"] for p in admin.get("/api/projects/")[1]["projects"]]
    ensure(pid not in listed, "the archived project is still in the default list")
    listed = [p["id"] for p in admin.get("/api/projects/?include_archived=true")[1]["projects"]]
    ensure(pid in listed, "the archived project is gone even with include_archived=true")
    expect(admin.get(f"/api/projects/{pid}"), 200, "admin opening the archived project")
    deliverables = admin.get(f"/api/projects/{pid}/deliverables/?include_archived=true")[1]
    deliverables = (deliverables or {}).get("deliverables", [])
    ensure(len(deliverables) == 3 and all(d.get("archived_at") for d in deliverables),
           f"the project's deliverables were not archived with it ({len(deliverables)} found)")
    allocations = admin.get(f"/api/allocations/?project_id={pid}&include_archived=true")[1]
    allocations = (allocations or {}).get("allocations", [])
    ensure(allocations and all(a.get("archived_at") for a in allocations),
           "the project's allocation was not archived with it")
    status, body = admin.delete(f"/api/projects/{pid}")
    ensure(status in (404, 405), f"DELETE /api/projects/<id> answered {got(status, body)}; "
                                 "there should be no delete")
    expect(admin.get(f"/api/projects/{pid}"), 200, "the project after a DELETE attempt")
    if demo.small_team:
        teams = admin.get("/api/teams/?include_archived=true")[1]["teams"]
        team = next((t for t in teams if t["id"] == demo.small_team["id"]), None)
        ensure(team and team.get("archived_at"), "the small smoke team from check 2 is not archived")
    return ("ana gets 403; marta archives the smoke project, a second archive is 409 "
            "already_archived; it leaves the default list but is still there by id and with "
            "include_archived, its 3 deliverables and allocation archived with it; DELETE is 404 "
            "and the record remains" + ("; check 2's small team is archived too"
                                        if demo.small_team else ""))


# (number, title, function) in the order they run: later checks depend on
# state the earlier ones leave (hal on no team, scratch records), and check 1
# scans every response, so it runs last.
CHECKS = [
    (8, "hal gets empty lists", check_hal_empty),
    (7, "Employee sees only own projects", check_employee_visibility),
    (3, "Manager team rule", check_team_rule),
    (2, "Small groups hidden", check_small_group_hidden),
    (4, "40-hour rule", check_forty_hours),
    (5, "Dependency loop", check_dependency_cycle),
    (6, "Start rule", check_start_rule),
    (11, "Archive, no delete", check_archive),
    (9, "Budget report", check_budget_report),
    (10, "Project search", check_search),
    (1, "Salary and rates admin-only", check_salary_privacy),
]


# =====================================================================
# Main
# =====================================================================
def _login_all() -> dict:
    """One login attempt per account; stops at the first failure."""
    sessions = {}
    for key, (role, var) in ACCOUNTS.items():
        password = os.getenv(var, "")
        if not password:
            raise CannotRun(f"{var} is not set (environment or .env.local)")
        _SECRETS.add(password)
        session = Session(key)
        try:
            status, body = session.login(password)
        except urllib.error.URLError:
            raise CannotRun(f"no server at {BASE_URL}; start scripts/dev_server.py") from None
        if status != 200:
            raise CannotRun(f"login as {key} failed ({got(status, body)}); stopped so no "
                            "account gets locked")
        if session.user.get("role") != role:
            raise CannotRun(f"{key} logged in with role {session.user.get('role')!r}, "
                            f"expected {role}")
        sessions[key] = session
    return sessions


def main() -> int:
    load_local_env()
    host = urllib.parse.urlsplit(BASE_URL).hostname
    if host not in ("127.0.0.1", "localhost"):
        say("Refusing to run: BASE_URL is not local, and this sends the demo passwords.")
        return 2
    demo = None
    try:
        sessions = _login_all()
        demo = Demo(sessions)
    except CannotRun as err:
        say(f"Cannot run: {err}")
        return 2
    say(f"Smoke test against {BASE_URL}, today {demo.today} (UTC), week of {demo.monday}")
    say("Logged in: " + ", ".join(f"{k} ({s.user.get('role')})" for k, s in sessions.items()))
    say()
    results = {}
    try:
        for number, title, check in CHECKS:
            try:
                results[number] = (True, title, check(demo))
            except Fail as err:
                results[number] = (False, title, str(err))
            except Exception as err:  # a crash is a failed check, not a stopped run
                results[number] = (False, title, f"script error: {type(err).__name__}: {err}")
    finally:
        retire_small_team(demo)
        if demo.scratch and not demo.scratch_archived:
            status, body = sessions["admin"].post(
                f"/api/projects/{demo.scratch['project']['id']}/archive")
            if status != 200:
                demo.notes.append(f"could not archive the smoke project ({got(status, body)})")
        for session in sessions.values():
            session.logout()
    for number in sorted(results):
        ok, title, reason = results[number]
        say(f"{number:>2} {'PASS' if ok else 'FAIL'}  {title}: {reason}")
    failed = sum(1 for ok, _, _ in results.values() if not ok)
    say()
    say(f"{len(results) - failed} passed, {failed} failed.")
    if demo.scratch or demo.small_team:
        say(f"Note: this run left archived 'smoke {demo.stamp} ...' records in the demo data "
            "(nothing is ever deleted); scripts/seed_demo.py --reset starts it clean.")
    for note in demo.notes:
        say(f"Cleanup problem: {note}")
    return 1 if failed or demo.notes else 0


if __name__ == "__main__":
    sys.exit(main())
