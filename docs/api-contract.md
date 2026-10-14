# API Contract: Teams, Projects, Deliverables, Allocations, Budgets, Reports

The single source of truth for the next block. Anything marked **ASSUMPTION** is not
confirmed yet; confirm or change it before building that part.

## 1. Conventions (same as the employees service)

- **Services and base paths.** `backend/teams` → `/api/teams`, `backend/projects` →
  `/api/projects` (deliverables are a sub-resource), `backend/allocations` → `/api/allocations`.
  **ASSUMPTION:** reports live in a fourth service, `backend/reports` → `/api/reports`
  (read-only SQL across all tables).
- **Auth.** Every endpoint needs `Authorization: Bearer <access token>`. The role always
  comes from the database row (`rbac.authenticate_request`), never from the token.
- **Errors.** Always `{"error": {"code": "...", "message": "..."}}`. **ASSUMPTION:** a few
  409s add an optional `"details"` object (stated where used). Messages never echo input.
- **Common errors on every endpoint.**
  `401 unauthorized | invalid_token | token_expired` (the frontend retries once via `withSessionRetry`),
  `403 forbidden`, `404 not_found` (unknown route, or an id that is not a valid UUID),
  `400 bad_request` (body not a JSON object, unknown fields, bad field), `413 payload_too_large` (over 64 KB).
- **Hidden records.** If the caller may not see a project (and anything under it), the answer
  is `404 not_found`, not 403, so ids cannot be probed. If they can see it but not change it: `403`.
- **Ids** are UUID strings. **Dates** are `YYYY-MM-DD`. **Timestamps** are ISO 8601.
  **Money** is a JSON number with 2 decimals. Lists come wrapped: `{"teams": [...]}`.
- **Archive, never delete.** `POST /{id}/archive` sets `archived_at`. Archived rows are hidden
  unless `?include_archived=true` (admin, and managers for their own teams' projects).
  Archiving twice → `409 already_archived`. Archived rows cannot be changed → `409 archived`.
- **Text fields:** trimmed, non-empty, max 200 chars (`name`), description max 2000, may be empty.
- **Weeks.** **ASSUMPTION:** a "calendar week" is an ISO week, Monday to Sunday, identified by
  its Monday (`week_start`). An allocation counts its full `hours_per_week` in every week its
  date range touches, even a partial week.
- **Hourly rate** = annual salary / 2080, using the *current* salary (**ASSUMPTION:** no salary
  history). Computed at full precision; only the final totals are rounded to 2 decimals.

## 2. Data model (migrations)

| Migration | Contents |
|---|---|
| 002_teams | `teams(id, name, lead_id → employees, created_at, archived_at)`, unique `lower(name)` among active teams; `employees.team_id uuid NULL → teams` |
| 003_projects | `projects(id, team_id → teams NOT NULL, name, description, status, start_date, end_date, created_at, archived_at)` |
| 004_deliverables | `deliverables(id, project_id, name, description, start_date, due_date, status, completed_at, created_at, archived_at)`; `deliverable_dependencies(deliverable_id, depends_on_id)` PK on the pair, CHECK they differ |
| 005_allocations | `allocations(id, employee_id, project_id, hours_per_week, start_date, end_date, created_by, created_at, archived_at)` |

**Change to the employees service:** the employee view gains `team_id` (nullable) for all
viewers. **ASSUMPTION:** an employee who leads an active team cannot be demoted to `employee`
or archived (`409 leads_team`); reassign the lead first.

## 3. Teams (`/api/teams`)

Team shape:
```json
{ "id": "uuid", "name": "Platform", "lead": {"id": "uuid", "name": "Ana"},
  "member_count": 4, "archived_at": null,
  "members": [{"id": "uuid", "name": "Bo", "job_title": "Dev", "role": "employee"}] }
```
`members` is included only on `GET /{id}` and on write responses.

| Method & path | Roles | Body | Success |
|---|---|---|---|
| `GET /` | admin: all; manager: teams they lead; employee: own team (**ASSUMPTION**) | — | `200 {"teams": [...]}` |
| `GET /{id}` | same visibility | — | `200 team` |
| `POST /` | admin | `{"name", "lead_id"}` | `201 team` |
| `PUT /{id}` | admin | any of `{"name", "lead_id"}` | `200 team` |
| `POST /{id}/members` | admin | `{"employee_id"}` | `200 team` |
| `DELETE /{id}/members/{employee_id}` | admin | — | `200 team` |
| `POST /{id}/archive` | admin | — | `200 team` |
| `GET /{id}/budget` | admin, that team's lead | — | `200 budget` (see §7) |

Rules and errors:
- `lead_id` must be an active employee with role manager or admin → else `400 invalid_lead`.
- A manager may lead several teams. **A lead is never a member of a team they lead:** naming
  a current member as lead (`POST`/`PUT`) or adding the lead as a member →
  `409 lead_cannot_be_member`. So the lead's own salary is never in their team's budget, and a
  manager cannot allocate themselves (only an admin can).
- Duplicate active team name (any case) → `409 name_taken`.
- Adding a member who is archived → `400 invalid_employee`; already on another team →
  `409 on_other_team` (remove them there first); already on this team → `409 already_member`.
- Removing someone who is not a member → `404 not_found`. **ASSUMPTION:** their existing
  allocations stay; only an admin can archive them afterwards.
- Changing `lead_id` changes the manager of every project of that team at once.
- Archive with any non-archived project → `409 has_active_projects`. On archive, members'
  `team_id` is cleared (**ASSUMPTION**).

## 4. Projects (`/api/projects`)

Project shape:
```json
{ "id": "uuid", "team": {"id": "uuid", "name": "Platform"}, "manager": {"id": "uuid", "name": "Ana"},
  "name": "Billing v2", "description": "", "status": "active",
  "start_date": "2026-11-02", "end_date": "2027-03-31", "archived_at": null }
```
`manager` is always the team's current lead (derived, not stored).
**ASSUMPTION:** `status` is one of `planned | active | on_hold | completed`.

Visibility (applies to every project, deliverable, allocation and report endpoint):
admin sees all; a manager sees projects of teams they lead; an employee sees projects
where they have a non-archived allocation (past, current or future — **ASSUMPTION**).

| Method & path | Roles | Body | Success |
|---|---|---|---|
| `GET /?team_id=&status=&include_archived=` | all (filtered by visibility) | — | `200 {"projects": [...]}` |
| `GET /{id}` | all who can see it | — | `200 project` |
| `POST /` | admin; manager for a team they lead (**ASSUMPTION**) | `{"team_id", "name", "description?", "status?", "start_date", "end_date"}` | `201 project` |
| `PUT /{id}` | admin; the project's manager | any of `name, description, status, start_date, end_date`; `team_id` admin only | `200 project` |
| `POST /{id}/archive` | admin; the project's manager | — | `200 project` |
| `GET /{id}/budget` | admin; the project's manager | — | `200 budget` (see §7) |

Rules and errors:
- `start_date <= end_date` → else `400 invalid_dates`. `status` defaults to `planned`.
- `team_id` must be an active team → `400 invalid_team`; a manager naming a team they do not
  lead → `403 forbidden`.
- Shrinking the dates so an allocation or deliverable falls outside → `409 dates_conflict`.
- `status: completed` while any deliverable is not `done` → `409 deliverables_open` (**ASSUMPTION**).
- Archiving also archives its deliverables and allocations (**ASSUMPTION**).

## 5. Deliverables (`/api/projects/{project_id}/deliverables`)

Deliverable shape:
```json
{ "id": "uuid", "project_id": "uuid", "name": "API spec", "description": "",
  "start_date": "2026-11-02", "due_date": "2026-11-20", "status": "in_progress",
  "completed_at": null, "depends_on": ["uuid"], "blocked": false, "overdue": false,
  "archived_at": null }
```
`status`: `not_started | in_progress | done` (**ASSUMPTION**). `blocked` = some dependency is
not `done`. `overdue` = `due_date` is past and status is not `done`. `completed_at` is set
by the server when status becomes `done`, cleared if it leaves `done`.

| Method & path | Roles | Body | Success |
|---|---|---|---|
| `GET /` | all who can see the project | — | `200 {"deliverables": [...]}` |
| `GET /{id}` | same | — | `200 deliverable` |
| `POST /` | admin; the project's manager | `{"name", "description?", "start_date", "due_date", "depends_on?": [ids]}` | `201 deliverable` |
| `PUT /{id}` | admin; the project's manager | any of `name, description, start_date, due_date, status` | `200 deliverable` |
| `PUT /{id}/dependencies` | admin; the project's manager | `{"depends_on": [ids]}` (replaces the whole set) | `200 deliverable` |
| `POST /{id}/archive` | admin; the project's manager | — | `200 deliverable` |

**ASSUMPTION:** employees are read-only here. (Option: let allocated employees change `status` only.)

Rules and errors:
- `start_date <= due_date`, both inside the project's dates → `400 invalid_dates`.
- Dependencies must be active deliverables of the *same* project (**ASSUMPTION**) →
  `400 invalid_dependency`. Depending on itself → `400 invalid_dependency`. Max 50 per deliverable.
- **No cycles:** if the new set would create a cycle → `409 dependency_cycle`, with
  `details: {"cycle": [ids]}`. Checked inside a transaction that locks the project's
  dependency rows, so two concurrent edits cannot build a cycle together.
- **Start rule:** moving to `in_progress` or `done` while any dependency is not `done` →
  `409 dependencies_not_done`, `details: {"pending": [ids]}`.
- Adding a not-done dependency to a deliverable that is already `in_progress` or `done` →
  `409 dependencies_not_done`.
- Moving a `done` deliverable back while a dependent has started → `409 dependents_started`.
- Archiving a deliverable that others depend on → `409 has_dependents`.
- **ASSUMPTION:** dates are not forced to follow dependencies (a deliverable may be planned to
  start before its dependency is due); this shows up as a risk in reports instead of an error.

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
| `GET /{id}` | same visibility | — | `200 allocation` |
| `POST /` | admin: anyone on any project; manager: only a member of a team they lead, on that team's project | `{"employee_id", "project_id", "hours_per_week", "start_date", "end_date"}` | `201 allocation` |
| `PUT /{id}` (**ASSUMPTION**: editing allowed) | same as POST | any of `hours_per_week, start_date, end_date` | `200 allocation` |
| `POST /{id}/archive` | admin; manager under the same rule as POST | — | `200 allocation` |

Rules and errors:
- `hours_per_week`: whole number 1–40 (**ASSUMPTION**: no half hours) → `400 bad_request`.
- `start_date <= end_date`, both required, inside the project's dates → `400 invalid_dates`.
- Employee archived → `400 invalid_employee`. Project archived or `completed` → `409 project_closed`.
- Manager breaking the team rule → `403 forbidden` (project not visible → `404`).
- **40-hour rule:** for every week the range touches, the employee's total across *all* their
  active allocations (including on projects the manager cannot see) plus this one must be ≤ 40.
  Else `409 over_allocated`, `details: {"weeks": [{"week_start": "2026-11-09", "hours": 48}]}`.
  Project names of other allocations are never revealed. The check locks the employee row so
  two concurrent requests cannot both pass. `PUT` re-runs the check without counting itself.
- Duplicate overlapping allocation of the same person on the same project →
  `409 overlapping_allocation` (**ASSUMPTION**: edit the existing one instead).

## 7. Budgets

**Salary rule:** only admin ever sees an individual salary or hourly rate.

**Minimum group size.** One constant, `MIN_AGGREGATE_GROUP = 3` (in `backend/common`), guards
both the team budget and project totals. When the group (active team members, or distinct people
allocated to a project) is smaller, a non-admin gets every money field as `null` and
`"hidden_reason": "below_min_group"`, never a number. When shown, `hidden_reason` is `null`.
Admin always gets the numbers (they can see salaries anyway).
Known limit: comparing totals before and after one person joins or leaves can still reveal a salary.

**Team budget** — `GET /api/teams/{id}/budget` (admin, that team's lead):
```json
{ "team_id": "uuid", "member_count": 4, "weekly": 7211.54, "yearly": 375000.00, "hidden_reason": null }
```
- `yearly` = sum of active members' annual salaries; `weekly` = yearly / 52. The lead is never
  a member (§3), so their own salary is never in it.

**Project budget** — `GET /api/projects/{id}/budget` (admin, the project's manager):
```json
{ "project_id": "uuid", "planned": 52000.00, "used": 18400.00, "remaining": 33600.00,
  "allocated_people": 3, "hidden_reason": null,
  "lines": [{"allocation_id": "uuid", "employee": {"id": "uuid", "name": "Bo"},
             "hours_per_week": 20, "weeks": 7, "hourly_rate": 52.88, "planned": 7403.85, "used": 2115.38}] }
```
- Per allocation: cost = `hours_per_week × hourly_rate × weeks touched` (same week rule as §1).
- `planned` = cost over the allocation's whole range. `used` = cost of the weeks up to and
  including the current week. **ASSUMPTION:** "planned" is computed from allocations; there is
  no separate budget figure typed in. (Option: add `projects.planned_budget` set by admin.)
- `lines` is **admin only**. Managers get totals only, and only when `allocated_people` is at
  least `MIN_AGGREGATE_GROUP`; otherwise `planned`, `used`, `remaining` are `null` with
  `"hidden_reason": "below_min_group"` (a manager sees the hours, so a small total would reveal a rate).

## 8. Reports (`/api/reports`, all `GET`)

Every report only covers what the caller can see (§4 visibility). Money follows §7.
Date windows: `from`/`to` default to the current week plus the next 11 (12 weeks); max 52 weeks
→ else `400 invalid_range`.

1. **Project status** — `/project-status?team_id=&status=` — all roles.
   `{"projects": [{"id", "name", "team", "manager", "status", "start_date", "end_date",
   "deliverables": {"total", "not_started", "in_progress", "done", "overdue", "blocked"},
   "percent_complete"}]}` (`percent_complete` = done / total, 0 when no deliverables).

2. **At-risk projects** — `/at-risk-projects` — admin, manager (**ASSUMPTION**: employees 403).
   `{"projects": [{"id", "name", "team", "manager", "reasons": ["overdue_deliverable", ...]}]}`.
   **ASSUMPTION** reasons: `past_end_date` (not completed after end date), `overdue_deliverable`,
   `blocked_past_start` (start date passed, dependencies not done), `dependency_date_conflict`
   (starts before a dependency is due), `unstaffed` (active, no allocation this week),
   `over_budget` (admin only: `used > planned`). Only projects with ≥ 1 reason are listed.

3. **Resource allocation** — `/resource-allocation?from=&to=&team_id=` — admin: everyone;
   manager: members of teams they lead; employee: themselves.
   `{"weeks": ["2026-11-02", ...], "people": [{"id", "name", "team_id",
   "weeks": [{"week_start", "total_hours", "projects": [{"id", "name", "hours"}], "other_hours"}]}]}`.
   `total_hours` counts all allocations; hours on projects the caller cannot see are summed
   into `other_hours` without names.

4. **Deliverable status** — `/deliverable-status?project_id=&status=&overdue=` — all roles.
   `{"deliverables": [{"id", "name", "project": {"id", "name"}, "status", "start_date",
   "due_date", "overdue", "blocked", "blocking": [ids]}]}`, ordered by `due_date`.

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
   `order` is a topological order; `depth` 0 = no dependencies. With `deliverable_id`, only that
   deliverable plus everything upstream and downstream of it. Missing `project_id` → `400`.

7. **Budget used vs planned** — `/budget?team_id=` — admin, manager. Employees → `403`.
   `{"projects": [{"id", "name", "team", "planned", "used", "remaining", "percent_used", "hidden_reason"}],
   "teams": [{"id", "name", "weekly", "yearly", "hidden_reason"}]}`.
   Managers get totals only, hidden below `MIN_AGGREGATE_GROUP` exactly as in §7. No per-person lines here, even for admin.

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
| Archive a project | `POST /api/projects/{id}/archive` | Project detail |
| Deliverables with dates | `GET/POST/PUT /api/projects/{id}/deliverables` | Project detail → Deliverables tab |
| Dependencies, no cycles | `PUT .../deliverables/{id}/dependencies` | Deliverable form → "depends on" picker |
| Cannot start before dependencies are done | `PUT .../deliverables/{id}` (status) | Deliverables tab → status control |
| Assign people to projects (manager: own team) | `POST/PUT /api/allocations`, `POST /api/allocations/{id}/archive` | Project detail → Allocations tab |
| 40 hours per week per person | `POST/PUT /api/allocations` (409 `over_allocated`) | Allocation form → error with weeks |
| Employee sees own allocations | `GET /api/allocations` | My work page (**ASSUMPTION**: new screen) |
| Salary / rate admin-only | all budget endpoints, allocation shape | Budget tab, Employees page |
| Project budget (managers: totals, hidden below 3 people) | `GET /api/projects/{id}/budget` | Project detail → Budget tab |
| Report: project status | `GET /api/reports/project-status` | Reports → Project status |
| Report: at-risk projects | `GET /api/reports/at-risk-projects` | Reports → At risk (also on dashboard) |
| Report: resource allocation | `GET /api/reports/resource-allocation` | Reports → Resources (week grid) |
| Report: deliverable status | `GET /api/reports/deliverable-status` | Reports → Deliverables |
| Report: over-allocated people (near capacity, default 32 h) | `GET /api/reports/over-allocated` | Reports → Near capacity |
| Report: dependency chain | `GET /api/reports/dependency-chain` | Project detail → Dependencies view |
| Report: budget used vs planned | `GET /api/reports/budget` | Reports → Budget |
