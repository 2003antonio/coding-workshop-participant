# API Contract: Teams, Projects, Deliverables, Allocations, Budgets, Reports

The single source of truth for this block. Everything below is built and covered by the
backend tests; former assumptions are now stated as rules. "Option" notes describe
possible later changes that are **not** built.

## 1. Conventions (same as the employees service)

- **Services and base paths.** `backend/teams` → `/api/teams`, `backend/projects` →
  `/api/projects` (deliverables are a sub-resource), `backend/allocations` → `/api/allocations`,
  `backend/reports` → `/api/reports` (read-only SQL across all tables).
- **Auth.** Every endpoint needs `Authorization: Bearer <access token>`. The role always
  comes from the database row (`rbac.authenticate_request`), never from the token.
- **Errors.** Always `{"error": {"code": "...", "message": "..."}}`. A few 409s add a
  `"details"` object (stated where used). Messages never echo input.
- **Common errors on every endpoint.**
  `401 unauthorized | invalid_token | token_expired` (the frontend retries once via `withSessionRetry`),
  `403 forbidden`, `404 not_found` (unknown route, or an id that is not a valid UUID),
  `400 bad_request` (body not a JSON object, unknown fields, bad field), `413 payload_too_large` (over 64 KB).
- **Role before record.** Each route first checks a minimum role. A caller below it gets
  `403` whatever the id (e.g. an employee calling any `PUT /api/projects/{id}`), so this
  reveals nothing about which ids exist.
- **Hidden records.** If the caller may not see a project (and anything under it), the answer
  is `404 not_found`, not 403, so ids cannot be probed. If they can see it but not change it: `403`.
- **Ids** are UUID strings. **Dates** are `YYYY-MM-DD`. **Timestamps** are ISO 8601.
  **Money** is a JSON number with 2 decimals. **Percentages** are JSON numbers from 0 to 100
  with one decimal (e.g. `38.2`). Lists come wrapped: `{"teams": [...]}`.
- **Archive, never delete.** `POST /{id}/archive` sets `archived_at`. Archived rows are hidden
  unless `?include_archived=true`. Who may pass it:
  - projects, deliverables, allocations: admin, and managers (who only see their own teams'
    projects anyway); an employee gets `403`.
  - teams: admin only; a manager or employee gets `403`.
  - `GET /api/projects/{id}` of an archived project works for admin and the project's
    manager without the flag; for anyone else it is `404`.

  Archiving twice → `409 already_archived`. Archived rows cannot be changed → `409 archived`.
- **Text fields:** trimmed, non-empty, max 200 chars (`name`), description max 2000, may be empty.
- **Weeks.** A "calendar week" is an ISO week, Monday to Sunday, identified by its Monday
  (`week_start`). An allocation counts its full `hours_per_week` in every week its date range
  touches, even a partial week.
- **Hourly rate** = annual salary / 2080, using the *current* salary (no salary history).
  Computed at full precision; only the final totals are rounded to 2 decimals (half up).
- **"Today"** is the server's UTC date.

## 2. Data model (migrations)

| Migration | Contents |
|---|---|
| 002_teams | `teams(id, name, lead_id → employees, created_at, archived_at)`, unique `lower(name)` among active teams; `employees.team_id uuid NULL → teams` |
| 003_projects | `projects(id, team_id → teams NOT NULL, name, description, status, start_date, end_date, created_at, archived_at)`, CHECK `start_date <= end_date` |
| 004_deliverables | `deliverables(id, project_id, name, description, start_date, due_date, status, completed_at, created_at, archived_at)`, CHECK `completed_at` set exactly when `done`; `deliverable_dependencies(deliverable_id, depends_on_id)` PK on the pair, CHECK they differ |
| 005_allocations | `allocations(id, employee_id, project_id, hours_per_week 1–40, start_date, end_date, created_by, created_at, archived_at)` |
| 006_planned_budget | `projects.planned_budget numeric(12,2) NULL`, CHECK `>= 0` (NULL = no budget set) |

**Change to the employees service:** the employee view gains `team_id` (nullable) for all
viewers. An employee who leads an active team cannot be demoted to `employee` or archived
(`409 leads_team`); reassign the lead first. Changing a lead between manager and admin is allowed.

## 3. Teams (`/api/teams`)

Team shape:
```json
{ "id": "uuid", "name": "Platform", "lead": {"id": "uuid", "name": "Ana"},
  "member_count": 4, "archived_at": null,
  "members": [{"id": "uuid", "name": "Bo", "job_title": "Dev", "role": "employee"}] }
```
`members` (active members, by name) is included only on `GET /{id}` and on write responses.
`member_count` counts active members only.

| Method & path | Roles | Body | Success |
|---|---|---|---|
| `GET /?include_archived=` | admin: all; manager: teams they lead; employee: own team | — | `200 {"teams": [...]}` |
| `GET /{id}` | same visibility (others `404`) | — | `200 team` |
| `POST /` | admin | `{"name", "lead_id"}` | `201 team` |
| `PUT /{id}` | admin | any of `{"name", "lead_id"}` | `200 team` |
| `POST /{id}/members` | admin | `{"employee_id"}` | `200 team` |
| `DELETE /{id}/members/{employee_id}` | admin | — | `200 team` |
| `POST /{id}/archive` | admin | — | `200 team` |
| `GET /{id}/budget` | admin, that team's lead (a member who can see the team: `403`) | — | `200 budget` (see §7) |

Rules and errors:
- `lead_id` must be an active employee with role manager or admin → else `400 invalid_lead`
  (also for a string that is not a UUID).
- A manager may lead several teams. **A lead is never a member of a team they lead:** naming
  a current member as lead (`PUT`) or adding the lead as a member →
  `409 lead_cannot_be_member`. So the lead's own salary is never in their team's budget, and a
  manager cannot allocate themselves (only an admin can). A lead may be a member of a
  *different* team.
- Duplicate active team name (any case) → `409 name_taken`. An archived team's name can be reused.
- Adding a member who is archived, unknown or not a UUID → `400 invalid_employee`; already on
  another team → `409 on_other_team` (remove them there first); already on this team →
  `409 already_member`.
- Removing someone who is not a member → `404 not_found`. Their existing allocations stay;
  after that, only an admin can change or archive those allocations (§6).
- Changing `lead_id` changes the manager of every project of that team at once.
- Archive with any non-archived project → `409 has_active_projects`. On archive, members'
  `team_id` is cleared.
- Changes to an archived team → `409 archived`.

## 4. Projects (`/api/projects`)

Project shape:
```json
{ "id": "uuid", "team": {"id": "uuid", "name": "Platform"}, "manager": {"id": "uuid", "name": "Ana"},
  "name": "Billing v2", "description": "", "status": "active",
  "start_date": "2026-11-02", "end_date": "2027-03-31", "archived_at": null,
  "planned_budget": 52000.00 }
```
`manager` is always the team's current lead (derived, not stored).
`status` is one of `planned | active | on_hold | completed`.
`planned_budget` (number or `null`) is present only for admin and the project's manager; the
key is absent for employees. It is a typed-in figure, not a salary.

**Visibility** (applies to every project, deliverable, allocation and report endpoint):
admin sees all; a manager sees **only** projects of teams they lead (not projects of other
teams, even ones they are allocated to — see §11); an employee sees active projects where they
have a non-archived allocation (past, current or future).

| Method & path | Roles | Body | Success |
|---|---|---|---|
| `GET /?team_id=&status=&q=&include_archived=` | all (filtered by visibility) | — | `200 {"projects": [...]}` |
| `GET /{id}` | all who can see it | — | `200 project` |
| `POST /` | admin; manager for a team they lead | `{"team_id", "name", "description?", "status?", "start_date", "end_date", "planned_budget?"}` | `201 project` |
| `PUT /{id}` | admin; the project's manager | any of `name, description, status, start_date, end_date, planned_budget`; `team_id` admin only | `200 project` |
| `POST /{id}/archive` | admin; the project's manager | — | `200 project` |
| `GET /{id}/budget` | admin; the project's manager | — | `200 budget` (see §7) |

List order: `start_date`, then name. Filters:
- `team_id` (UUID, else `400`), `status` (one of the four, else `400`).
- **`q`**: optional search text, trimmed, max 100 characters (else `400 bad_request`); blank
  means no search. Matches `name` **or** `description`, case-insensitive, as a substring.
  LIKE wildcards in the input are literal (`q=50%` matches only "50%", `q=_` only "_").
  Sent as a query parameter (parameterised SQL). All filters are ANDed with the visibility
  rule in the same query, so `q` can only narrow the visible list and never reveals a
  project the caller cannot see.

Rules and errors:
- `start_date <= end_date` → else `400 invalid_dates`. `status` defaults to `planned`.
- `team_id` must be an active team → `400 invalid_team` (also for a non-UUID string); a
  manager naming a team they do not lead → `403 forbidden`; a manager sending `team_id` on
  `PUT` → `403`.
- `planned_budget`: number from 0 to 9,999,999,999.99 with at most 2 decimals, or `null`
  (on `PUT`, `null` clears it; leaving the key out keeps it) → else `400 bad_request`.
- Shrinking the dates so an active allocation or deliverable falls outside → `409 dates_conflict`.
- `status: completed` while any active deliverable is not `done` → `409 deliverables_open`.
- Archiving also archives its deliverables and allocations.
- Changes are audited by field name only (never values).

## 5. Deliverables (`/api/projects/{project_id}/deliverables`)

Deliverable shape:
```json
{ "id": "uuid", "project_id": "uuid", "name": "API spec", "description": "",
  "start_date": "2026-11-02", "due_date": "2026-11-20", "status": "in_progress",
  "completed_at": null, "depends_on": ["uuid"], "blocked": false, "overdue": false,
  "archived_at": null }
```
`status`: `not_started | in_progress | done` (new deliverables start `not_started`).
`blocked` = some active dependency is not `done`. `overdue` = `due_date` is before today and
status is not `done`. `completed_at` is set by the server when status becomes `done`, cleared
if it leaves `done`. Lists are ordered by `due_date`, then name.

| Method & path | Roles | Body | Success |
|---|---|---|---|
| `GET /?include_archived=` | all who can see the project | — | `200 {"deliverables": [...]}` |
| `GET /{id}` | same (archived: admin and manager only) | — | `200 deliverable` |
| `POST /` | admin; the project's manager | `{"name", "description?", "start_date", "due_date", "depends_on?": [ids]}` | `201 deliverable` |
| `PUT /{id}` | admin; the project's manager | any of `name, description, start_date, due_date, status` | `200 deliverable` |
| `PUT /{id}/dependencies` | admin; the project's manager | `{"depends_on": [ids]}` (replaces the whole set) | `200 deliverable` |
| `POST /{id}/archive` | admin; the project's manager | — | `200 deliverable` |

Employees are read-only here. (Option, not built: let allocated employees change `status` only.)

Rules and errors:
- `start_date <= due_date`, both inside the project's dates → `400 invalid_dates`.
- Dependencies must be active deliverables of the *same* project → `400 invalid_dependency`
  (also for unknown or non-UUID ids). Depending on itself → `400 invalid_dependency`.
  Duplicates are ignored. More than 50 → `400 invalid_dependency`.
- **No cycles:** if the new set would create a cycle → `409 dependency_cycle`, with
  `details: {"cycle": [ids]}` — starting with the edited deliverable; each id depends on the
  next, and the last depends on the first. Nothing is written.
- **Locking:** every write to a project's deliverables (create, update, dependencies, archive)
  first locks **the project row** (`SELECT ... FOR UPDATE`). All writes inside one project
  therefore run one at a time, so two concurrent edits cannot build a cycle together and the
  start rule cannot be raced. (Locking individual dependency rows would not cover rows that
  do not exist yet.)
- **Start rule:** moving to `in_progress` or `done` while any dependency is not `done` →
  `409 dependencies_not_done`, `details: {"pending": [ids]}`.
- Adding a not-done dependency to a deliverable that is already `in_progress` or `done` →
  `409 dependencies_not_done`, `details: {"pending": [the added not-done ids]}`.
- Moving a `done` deliverable back while a dependent has started → `409 dependents_started`.
- Archiving a deliverable that active others depend on → `409 has_dependents`.
- Dates are not forced to follow dependencies (a deliverable may be planned to start before
  its dependency is due); this shows up as a risk in reports instead of an error.
- Writes on an archived project → `409 archived`.

## 6. Allocations (`/api/allocations`)

Allocation shape:
```json
{ "id": "uuid", "employee": {"id": "uuid", "name": "Bo"}, "project": {"id": "uuid", "name": "Billing v2"},
  "hours_per_week": 20, "start_date": "2026-11-02", "end_date": "2026-12-18", "archived_at": null }
```
Admin responses also include `"hourly_rate"` and `"weekly_cost"`. Never for anyone else.

| Method & path | Roles | Body | Success |
|---|---|---|---|
| `GET /?project_id=&employee_id=&from=&to=&include_archived=` | admin: all; manager: on their teams' projects; employee: own only | — | `200 {"allocations": [...]}` |
| `GET /{id}` | same visibility (others `404`) | — | `200 allocation` |
| `POST /` | admin: anyone on any project; manager: only a member of a team they lead, on that team's project | `{"employee_id", "project_id", "hours_per_week", "start_date", "end_date"}` | `201 allocation` |
| `PUT /{id}` | same as POST | any of `hours_per_week, start_date, end_date` | `200 allocation` |
| `POST /{id}/archive` | admin; manager under the same rule as POST | — | `200 allocation` |

`from`/`to` keep allocations that overlap that range. Lists are ordered by `start_date`, then person.

Rules and errors:
- `hours_per_week`: whole number 1–40 (no half hours) → `400 bad_request`.
- `start_date <= end_date`, both required, inside the project's dates → `400 invalid_dates`.
- Employee archived, unknown or not a UUID → `400 invalid_employee`. `project_id` not a UUID →
  `400 bad_request`; unknown or not visible → `404`. Project archived or `completed` →
  `409 project_closed` (on `POST` and `PUT`).
- Manager breaking the team rule → `403 forbidden` (project not visible → `404`). This also
  applies to `PUT` and archive: once a person leaves the team, only an admin can change their
  allocations there.
- **40-hour rule:** for every week the range touches, the employee's total across *all* their
  active allocations (including on projects the manager cannot see) plus this one must be ≤ 40.
  Else `409 over_allocated`, `details: {"weeks": [{"week_start": "2026-11-09", "hours": 48}]}`.
  Project names of other allocations are never revealed. The check locks the employee row so
  two concurrent requests cannot both pass. `PUT` re-runs the check without counting itself.
- Overlapping allocation of the same person on the same project →
  `409 overlapping_allocation` (edit the existing one instead).

## 7. Budgets

**Salary rule:** only admin ever sees an individual salary or hourly rate.

**Minimum group size.** One constant, `MIN_AGGREGATE_GROUP = 3` (in `backend/common/budget.py`),
guards the team budget, the project budget and the budget report. When the group (active team
members, or distinct people allocated to a project) is smaller, a non-admin gets every
salary-derived field as `null` and `"hidden_reason": "below_min_group"`, never a number. When
shown, `hidden_reason` is `null`. Admin always gets the numbers (they can see salaries anyway).
`planned_budget` is typed in, not salary-derived, so it is never hidden from those who may see it.
Known limit: comparing totals before and after one person joins or leaves can still reveal a salary.

**Team budget** — `GET /api/teams/{id}/budget` (admin, that team's lead):
```json
{ "team_id": "uuid", "member_count": 4, "weekly": 7211.54, "yearly": 375000.00, "hidden_reason": null }
```
- `yearly` = sum of active members' annual salaries; `weekly` = yearly / 52. The lead is never
  a member (§3), so their own salary is never in it.

**Project budget** — `GET /api/projects/{id}/budget` (admin, the project's manager):
```json
{ "project_id": "uuid", "planned_budget": 20000.00, "committed_cost": 13000.00,
  "used_cost_to_date": 6800.00, "percent_used": 34.0, "over_budget": false,
  "allocated_people": 3, "hidden_reason": null,
  "lines": [{"allocation_id": "uuid", "employee": {"id": "uuid", "name": "Bo"},
             "hours_per_week": 20, "weeks": 7, "hourly_rate": 50.00,
             "committed_cost": 7000.00, "used_cost_to_date": 2000.00}] }
```
- Per allocation: cost = `hours_per_week × hourly_rate × weeks touched` (same week rule as §1).
- `committed_cost` = cost of active allocations over their whole ranges (the same figure as
  in report 7). `used_cost_to_date` = cost of the weeks up to and including the current week.
- `planned_budget` = the typed-in budget (§4), or `null`. It is not salary-derived, so admin
  and the project's manager always see it, even when the costs are hidden.
- `percent_used` and `over_budget`: same definitions as report 7 (§8) —
  `used_cost_to_date / planned_budget × 100` (one decimal, `null` when there is no planned
  budget or it is 0) and `committed_cost > planned_budget` (`null` when there is no planned
  budget).
- `lines` is **admin only**, ordered by person then start date. Managers get totals only, and
  only when `allocated_people` is at least `MIN_AGGREGATE_GROUP`; otherwise `committed_cost`,
  `used_cost_to_date`, `percent_used` and `over_budget` are all `null` with
  `"hidden_reason": "below_min_group"` (a manager sees the hours, so a small total would
  reveal a rate, and the percentage or flag would reveal the total).

## 8. Reports (`/api/reports`, all `GET`)

Every report only covers what the caller can see (§4 visibility), and only active (non-archived)
projects, deliverables and allocations. Money follows §7.
Date windows: `from`/`to` default to the current week plus the next 11 (12 weeks). With only
`from`, the window is the 12 weeks starting at its week; with only `to`, the 12 weeks ending
with its week. `from` after `to`, or more than 52 weeks → `400 invalid_range`; a malformed date
→ `400 bad_request`.

1. **Project status** — `/project-status?team_id=&status=` — all roles.
   `{"projects": [{"id", "name", "team", "manager", "status", "start_date", "end_date",
   "deliverables": {"total", "not_started", "in_progress", "done", "overdue", "blocked"},
   "percent_complete"}]}`. `percent_complete` = done / total × 100 (0–100, one decimal),
   `0` when there are no deliverables.

2. **At-risk projects** — `/at-risk-projects` — admin, manager (employees `403`).
   `{"projects": [{"id", "name", "team", "manager", "reasons": ["overdue_deliverable", ...]}]}`.
   Reasons, always in this order:
   - `past_end_date`: not `completed` and `end_date` is before today.
   - `overdue_deliverable`: some deliverable is overdue.
   - `blocked_past_start`: some deliverable that is not done has a start date before today
     and a dependency that is not done.
   - `dependency_date_conflict`: some deliverable that is not done starts before the due date
     of one of its not-done dependencies.
   - `unstaffed`: status `active` and no allocation touches the current week.
   - `over_budget` (**admin only**): `planned_budget` is set and the committed cost is above it.

   Only projects with ≥ 1 reason are listed.

3. **Resource allocation** — `/resource-allocation?from=&to=&team_id=` — admin: everyone;
   manager: members of teams they lead; employee: themselves.
   `{"weeks": ["2026-11-02", ...], "people": [{"id", "name", "team_id",
   "weeks": [{"week_start", "total_hours", "projects": [{"id", "name", "hours"}], "other_hours"}]}]}`.
   `total_hours` counts all allocations; hours on projects the caller cannot see are summed
   into `other_hours` without names. `team_id` narrows the caller's people scope; a team
   outside it gives an empty `people` list, not an error.

4. **Deliverable status** — `/deliverable-status?project_id=&status=&overdue=` — all roles.
   `{"deliverables": [{"id", "name", "project": {"id", "name"}, "status", "start_date",
   "due_date", "overdue", "blocked", "blocking": [ids]}]}`, ordered by `due_date`.
   `blocking` = the active deliverables that depend on this one, while this one is not `done`
   (the work it is holding up); `[]` once it is done. `overdue` is `true`/`false`. A
   `project_id` the caller cannot see → `404`.

5. **Over-allocated people ("near capacity")** — `/over-allocated?from=&to=&threshold=` — admin,
   manager (same people scope as report 3). `threshold` is a whole number 1–40, default **32**
   → else `400 bad_request`.
   `{"label": "near capacity", "threshold": 32, "people": [{"id", "name",
   "weeks": [{"week_start", "total_hours"}]}]}` listing only weeks where `total_hours > threshold`.
   The 40-hour rule blocks anything above 40, so `threshold=40` works as a data-integrity check
   (should be empty).

6. **Dependency chain** — `/dependency-chain?project_id=` (required) `&deliverable_id=` (optional)
   — all who can see the project.
   `{"project_id", "nodes": [{"id", "name", "status", "start_date", "due_date", "depth"}],
   "edges": [{"from": "dependency id", "to": "dependent id"}], "order": [ids], "longest_chain": [ids]}`.
   `order` is a topological order (ties by due date, then name); `nodes` follow it. `depth` 0 =
   no dependencies. With `deliverable_id`, only that deliverable plus everything upstream and
   downstream of it, and depths are counted within that subgraph. Missing or malformed
   `project_id` → `400`; a project or deliverable the caller cannot see → `404`.

7. **Budget** — `/budget?team_id=` — admin, manager. Employees → `403`.
   ```json
   { "projects": [{ "id": "uuid", "name": "Billing v2", "team": {"id": "uuid", "name": "Platform"},
                    "planned_budget": 10000.00, "committed_cost": 11000.00,
                    "used_cost_to_date": 4200.00, "percent_used": 42.0,
                    "over_budget": true, "hidden_reason": null }],
     "teams": [{ "id": "uuid", "name": "Platform", "weekly": 6000.00, "yearly": 312000.00,
                 "hidden_reason": null }] }
   ```
   Per project:
   - `planned_budget`: the typed-in budget, or `null` if none. Never hidden.
   - `committed_cost`: cost of all active allocations over their full ranges (same figure
     as the project budget, §7).
   - `used_cost_to_date`: cost of the weeks up to and including the current week.
   - `percent_used`: `used_cost_to_date / planned_budget × 100` (0–100 scale, one decimal, may
     exceed 100); `null` when there is no planned budget or it is 0.
   - `over_budget`: `committed_cost > planned_budget`; `null` when there is no planned budget.
   - For a manager below `MIN_AGGREGATE_GROUP` allocated people: `committed_cost`,
     `used_cost_to_date`, `percent_used` and `over_budget` are `null` and `hidden_reason` is
     `"below_min_group"`. Admin always gets numbers.

   `teams`: admin all active teams, a manager the teams they lead; hidden below
   `MIN_AGGREGATE_GROUP` members exactly as in §7. No per-person lines here, even for admin.

## 9. Error codes added in this block

| Code | Status | Where |
|---|---|---|
| `invalid_lead`, `invalid_team`, `invalid_employee`, `invalid_dependency`, `invalid_dates`, `invalid_range` | 400 | input that refers to the wrong thing |
| `name_taken`, `on_other_team`, `already_member`, `has_active_projects`, `leads_team`, `lead_cannot_be_member` | 409 | teams / employees |
| `dates_conflict`, `deliverables_open`, `project_closed` | 409 | projects |
| `dependency_cycle`, `dependencies_not_done`, `dependents_started`, `has_dependents` | 409 | deliverables |
| `over_allocated`, `overlapping_allocation` | 409 | allocations |
| `archived`, `already_archived` | 409 | everywhere (existing codes) |

## 10. Requirement → endpoint(s) → screen

| Requirement | Endpoint(s) | Screen |
|---|---|---|
| Admin creates teams and picks a lead (never a member) | `POST/PUT /api/teams`, `GET /api/employees` | Teams page → team form |
| Admin adds / removes members (one team each) | `POST/DELETE /api/teams/{id}/members` | Team detail → members list |
| Archive a team | `POST /api/teams/{id}/archive` | Team detail |
| Team budget for lead and admin (hidden below 3 members) | `GET /api/teams/{id}/budget` | Team detail → budget card |
| Projects belong to one team, manager = lead | `POST/PUT /api/projects` | Projects page → project form |
| Role-based project visibility | `GET /api/projects`, `GET /api/projects/{id}` | Projects page |
| Search projects by name or description | `GET /api/projects?q=` | Projects page → search box |
| Planned budget per project (admin and manager) | `POST/PUT /api/projects` (`planned_budget`) | Project form → budget field |
| Archive a project | `POST /api/projects/{id}/archive` | Project detail |
| Deliverables with dates | `GET/POST/PUT /api/projects/{id}/deliverables` | Project detail → Deliverables tab |
| Dependencies, no cycles | `PUT .../deliverables/{id}/dependencies` | Deliverable form → "depends on" picker |
| Cannot start before dependencies are done | `PUT .../deliverables/{id}` (status) | Deliverables tab → status control |
| Assign people to projects (manager: own team) | `POST/PUT /api/allocations`, `POST /api/allocations/{id}/archive` | Project detail → Allocations tab |
| 40 hours per week per person | `POST/PUT /api/allocations` (409 `over_allocated`) | Allocation form → error with weeks |
| Employee sees own allocations | `GET /api/allocations` | My work page (new screen) |
| Salary / rate admin-only | all budget endpoints, allocation shape | Budget tab, Employees page |
| Project budget (managers: totals, hidden below 3 people) | `GET /api/projects/{id}/budget` | Project detail → Budget tab |
| Report: project status | `GET /api/reports/project-status` | Reports → Project status |
| Report: at-risk projects | `GET /api/reports/at-risk-projects` | Reports → At risk (also on dashboard) |
| Report: resource allocation | `GET /api/reports/resource-allocation` | Reports → Resources (week grid) |
| Report: deliverable status | `GET /api/reports/deliverable-status` | Reports → Deliverables |
| Report: over-allocated people (near capacity, default 32 h) | `GET /api/reports/over-allocated` | Reports → Near capacity |
| Report: dependency chain | `GET /api/reports/dependency-chain` | Project detail → Dependencies view |
| Report: budget vs planned budget | `GET /api/reports/budget` | Reports → Budget |

## 11. Known gaps (allowed by design for now)

These are deliberate, tested behaviours that a later block may change:
- **Managers only see projects of teams they lead.** A manager whom an admin allocates to
  another team's project cannot see that project or that allocation; the hours still count
  toward their 40-hour limit.
- A `completed` project can still get a new deliverable, and a `done` deliverable on it can be
  reopened (subject to the start rule); the project stays `completed`.
- Archiving an employee leaves their team membership and allocations as they are; those
  allocations still count in project costs until an admin archives them. An archived person
  is not counted in `member_count` or the team budget, and gets no new allocations.
- Report 3 with a `team_id` outside the caller's scope returns an empty list rather than `403`.
- `include_archived` on teams is admin-only (§1).
