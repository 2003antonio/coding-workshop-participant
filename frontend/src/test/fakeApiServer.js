// Test helper: an in-memory server for the whole API, built from
// docs/api-contract.md, behind a mocked global fetch (same style as
// fakeAuthServer.js). It restores a signed-in session for one user, applies the
// contract's visibility and money-hiding rules for that user's role, and keeps
// state, so a POST is visible in the next GET.
//
//   const server = signedInAs('manager')                 // Max Manager, leads Platform
//   const server = signedInAs('employee', { routes: {    // exact-path overrides win
//     'GET /api/projects/': () => reply(500, {...}) } })
//   server.calls, server.count(method, path), server.db
import { REFRESH_TOKEN_KEY } from '../auth/tokenStorage'
import { fakeAuthServer, reply } from './fakeAuthServer'

export { reply }

export const MIN_AGGREGATE_GROUP = 3
export const TODAY = '2026-11-10' // a Tuesday; its week starts 2026-11-09

const person = (id, name, role, job_title, salary, team_id = null) => ({
  id, name, role, job_title, salary, team_id, email: `${name.split(' ')[0].toLowerCase()}@acme.test`, archived_at: null,
})

/** A fresh copy of the seed data. Platform has 3 members, Data has 1. */
export function seedData() {
  return {
    employees: [
      person('u-1', 'Ada Admin', 'admin', 'Head of Ops', 150000),
      person('u-2', 'Max Manager', 'manager', 'Delivery Lead', 120000),
      person('u-3', 'Eve Employee', 'employee', 'Engineer', 90000.5, 't-1'),
      person('u-4', 'Bo Builder', 'employee', 'Engineer', 83200, 't-1'),
      person('u-5', 'Cy Coder', 'employee', 'Designer', 72800, 't-1'),
      person('u-6', 'Mia Manager', 'manager', 'Data Lead', 125000),
      person('u-7', 'Dee Data', 'employee', 'Analyst', 70000, 't-2'),
      person('u-8', 'Nia New', 'employee', 'Intern', 41600),
    ],
    teams: [
      { id: 't-1', name: 'Platform', lead_id: 'u-2', archived_at: null },
      { id: 't-2', name: 'Data', lead_id: 'u-6', archived_at: null },
    ],
    projects: [
      { id: 'p-1', team_id: 't-1', name: 'Billing v2', description: 'New invoices', status: 'active',
        start_date: '2026-11-02', end_date: '2027-03-31', planned_budget: 12000, archived_at: null },
      { id: 'p-2', team_id: 't-2', name: 'Data Lake', description: '', status: 'planned',
        start_date: '2026-11-02', end_date: '2027-02-26', planned_budget: null, archived_at: null },
      { id: 'p-3', team_id: 't-1', name: 'Old Portal', description: '', status: 'completed',
        start_date: '2026-01-05', end_date: '2026-06-30', planned_budget: null, archived_at: '2026-07-01T09:00:00+00:00' },
    ],
    deliverables: [
      { id: 'd-1', project_id: 'p-1', name: 'API spec', description: '', start_date: '2026-11-02',
        due_date: '2026-11-06', status: 'done', completed_at: '2026-11-06T16:00:00+00:00', depends_on: [], archived_at: null },
      { id: 'd-2', project_id: 'p-1', name: 'Backend', description: '', start_date: '2026-11-09',
        due_date: '2026-12-04', status: 'in_progress', completed_at: null, depends_on: ['d-1'], archived_at: null },
      { id: 'd-3', project_id: 'p-1', name: 'Frontend', description: '', start_date: '2026-11-02',
        due_date: '2026-11-09', status: 'not_started', completed_at: null, depends_on: ['d-2'], archived_at: null },
      { id: 'd-4', project_id: 'p-2', name: 'Ingest', description: '', start_date: '2026-11-02',
        due_date: '2026-12-18', status: 'not_started', completed_at: null, depends_on: [], archived_at: null },
    ],
    allocations: [
      { id: 'a-1', employee_id: 'u-3', project_id: 'p-1', hours_per_week: 20,
        start_date: '2026-11-02', end_date: '2026-12-18', archived_at: null },
      { id: 'a-2', employee_id: 'u-4', project_id: 'p-1', hours_per_week: 10,
        start_date: '2026-11-02', end_date: '2026-12-18', archived_at: null },
      { id: 'a-3', employee_id: 'u-5', project_id: 'p-1', hours_per_week: 16,
        start_date: '2026-11-09', end_date: '2026-11-20', archived_at: null },
      { id: 'a-4', employee_id: 'u-7', project_id: 'p-2', hours_per_week: 36,
        start_date: '2026-11-02', end_date: '2026-11-27', archived_at: null },
      { id: 'a-5', employee_id: 'u-3', project_id: 'p-2', hours_per_week: 16,
        start_date: '2026-11-16', end_date: '2026-11-20', archived_at: null },
    ],
  }
}

export const USER_FOR_ROLE = { admin: 'u-1', manager: 'u-2', employee: 'u-3' }

// ---- dates and weeks (ISO weeks, identified by their Monday) ----

const DAY = 86400000
const toTime = (date) => Date.parse(`${date}T00:00:00Z`)
const toDate = (time) => new Date(time).toISOString().slice(0, 10)
export function mondayOf(date) {
  const time = toTime(date)
  const weekday = (new Date(time).getUTCDay() + 6) % 7 // Monday = 0
  return toDate(time - weekday * DAY)
}
function weeksTouched(start, end) {
  const weeks = []
  for (let t = toTime(mondayOf(start)); t <= toTime(end); t += 7 * DAY) weeks.push(toDate(t))
  return weeks
}
const round2 = (n) => Math.round(n * 100) / 100
const round1 = (n) => Math.round(n * 10) / 10

// ---- the server ----

const err = (status, code, details) =>
  reply(status, { error: { code, message: `Server text for ${code}.`, ...(details ? { details } : {}) } })

let nextId = 100

function createApi(db, meId, today) {
  const active = (row) => !row.archived_at
  const byId = (table, id) => db[table].find((row) => row.id === id)
  const me = () => byId('employees', meId)
  const isAdmin = () => me().role === 'admin'
  const ledTeamIds = () => db.teams.filter((t) => active(t) && t.lead_id === meId).map((t) => t.id)
  const leads = (teamId) => ledTeamIds().includes(teamId)
  const ref = (row) => (row ? { id: row.id, name: row.name } : null)
  const members = (teamId) => db.employees.filter((e) => active(e) && e.team_id === teamId)
  const salaryOf = (employeeId) => byId('employees', employeeId).salary
  const thisWeek = mondayOf(today)

  function canSeeProject(project) {
    if (isAdmin()) return true
    if (me().role === 'manager') return leads(project.team_id)
    return db.allocations.some((a) => active(a) && a.employee_id === meId && a.project_id === project.id)
  }
  const canManageProject = (project) => isAdmin() || leads(project.team_id)
  function canSeeTeam(team) {
    if (isAdmin()) return true
    if (me().role === 'manager') return team.lead_id === meId
    return me().team_id === team.id
  }
  function canSeeEmployeeHours(employee) {
    if (isAdmin()) return true
    if (me().role === 'manager') return leads(employee.team_id)
    return employee.id === meId
  }

  // ---- views ----
  const teamView = (team, withMembers = false) => ({
    id: team.id, name: team.name, lead: ref(byId('employees', team.lead_id)),
    member_count: members(team.id).length, archived_at: team.archived_at,
    ...(withMembers ? {
      members: members(team.id).map(({ id, name, job_title, role }) => ({ id, name, job_title, role })),
    } : {}),
  })
  function projectView(project) {
    const team = byId('teams', project.team_id)
    const view = {
      id: project.id, team: ref(team), manager: ref(byId('employees', team.lead_id)),
      name: project.name, description: project.description, status: project.status,
      start_date: project.start_date, end_date: project.end_date, archived_at: project.archived_at,
    }
    // The typed budget goes to the people who may set it: admin and the project's manager.
    return canManageProject(project) ? { ...view, planned_budget: project.planned_budget ?? null } : view
  }
  function deliverableView(d) {
    const deps = d.depends_on.map((id) => byId('deliverables', id))
    return {
      ...d, depends_on: [...d.depends_on],
      blocked: deps.some((dep) => dep.status !== 'done'),
      overdue: d.due_date < today && d.status !== 'done',
    }
  }
  function allocationView(a) {
    const view = {
      id: a.id, employee: ref(byId('employees', a.employee_id)), project: ref(byId('projects', a.project_id)),
      hours_per_week: a.hours_per_week, start_date: a.start_date, end_date: a.end_date, archived_at: a.archived_at,
    }
    if (isAdmin()) {
      const rate = salaryOf(a.employee_id) / 2080
      view.hourly_rate = round2(rate)
      view.weekly_cost = round2(rate * a.hours_per_week)
    }
    return view
  }
  function employeeView(e) {
    const view = { id: e.id, name: e.name, email: e.email, job_title: e.job_title, role: e.role, team_id: e.team_id }
    return isAdmin() ? { ...view, salary: e.salary, archived_at: e.archived_at } : view
  }

  // ---- money ----
  function allocationCost(a) {
    const rate = salaryOf(a.employee_id) / 2080
    const weeks = weeksTouched(a.start_date, a.end_date)
    const usedWeeks = weeks.filter((w) => w <= thisWeek).length
    return {
      rate, weeks: weeks.length,
      committed: rate * a.hours_per_week * weeks.length, used: rate * a.hours_per_week * usedWeeks,
    }
  }
  /**
   * planned_budget: typed by admin or the manager (null = not set). It is not
   * derived from pay, so it is never hidden. The rest is computed from the
   * assignments and hidden from non-admins below MIN_AGGREGATE_GROUP people:
   *   committed_cost    = cost of every assignment over its whole range
   *   used_cost_to_date = cost of the weeks up to and including this one
   *   percent_used      = used_cost_to_date / planned_budget × 100, one decimal
   *                       (null when there is no planned budget or it is 0)
   *   over_budget       = committed_cost > planned_budget (null when there is no planned budget)
   * Same definitions and hiding in GET /api/projects/{id}/budget and report 7.
   */
  function projectMoney(project) {
    const rows = db.allocations.filter((a) => active(a) && a.project_id === project.id)
    const people = new Set(rows.map((a) => a.employee_id)).size
    const costs = rows.map((a) => ({ a, ...allocationCost(a) }))
    const committed = costs.reduce((s, c) => s + c.committed, 0)
    const used = costs.reduce((s, c) => s + c.used, 0)
    const budget = project.planned_budget ?? null
    const hidden = !isAdmin() && people < MIN_AGGREGATE_GROUP
    return {
      costs, people, hidden,
      planned_budget: budget,
      committed_cost: hidden ? null : round2(committed),
      used_cost_to_date: hidden ? null : round2(used),
      percent_used: hidden || !budget ? null : round1((used / budget) * 100),
      over_budget: hidden || budget === null ? null : round2(committed) > budget,
      hidden_reason: hidden ? 'below_min_group' : null,
    }
  }
  const MONEY_FIELDS = ['planned_budget', 'committed_cost', 'used_cost_to_date', 'percent_used', 'over_budget', 'hidden_reason']
  const moneyFields = (money) => Object.fromEntries(MONEY_FIELDS.map((k) => [k, money[k]]))
  function badBudget(value) {
    if (value === undefined || value === null) return false
    return typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 9999999999.99
      || Math.round(value * 100) !== value * 100
  }
  function teamMoney(team) {
    const list = members(team.id)
    const yearly = list.reduce((s, e) => s + e.salary, 0)
    const hidden = !isAdmin() && list.length < MIN_AGGREGATE_GROUP
    return {
      member_count: list.length,
      weekly: hidden ? null : round2(yearly / 52),
      yearly: hidden ? null : round2(yearly),
      hidden_reason: hidden ? 'below_min_group' : null,
    }
  }

  // ---- lookups that answer 404 when hidden ----
  function visibleProject(id) {
    const project = byId('projects', id)
    return project && canSeeProject(project) ? project : null
  }
  function visibleTeam(id) {
    const team = byId('teams', id)
    return team && canSeeTeam(team) ? team : null
  }
  const notFound = () => err(404, 'not_found')
  const forbidden = () => err(403, 'forbidden')

  function weekLoad(employeeId, { skipId } = {}) {
    const load = {}
    for (const a of db.allocations) {
      if (!active(a) || a.employee_id !== employeeId || a.id === skipId) continue
      for (const w of weeksTouched(a.start_date, a.end_date)) load[w] = (load[w] ?? 0) + a.hours_per_week
    }
    return load
  }

  function reportWindow(query) {
    const from = mondayOf(query.get('from') || thisWeek)
    const to = query.get('to') || toDate(toTime(from) + 11 * 7 * DAY)
    const weeks = weeksTouched(from, to)
    return weeks.length > 52 ? null : weeks
  }
  function peopleInScope(teamId) {
    return db.employees.filter((e) => active(e) && canSeeEmployeeHours(e) && (!teamId || e.team_id === teamId))
  }
  function resourceRows(weeks, teamId) {
    return peopleInScope(teamId).map((e) => ({
      id: e.id, name: e.name, team_id: e.team_id,
      weeks: weeks.map((week_start) => {
        const rows = db.allocations.filter((a) => active(a) && a.employee_id === e.id
          && mondayOf(a.start_date) <= week_start && a.end_date >= week_start)
        const seen = rows.filter((a) => canSeeProject(byId('projects', a.project_id)))
        const total = rows.reduce((s, a) => s + a.hours_per_week, 0)
        const shown = seen.reduce((s, a) => s + a.hours_per_week, 0)
        return {
          week_start, total_hours: total, other_hours: total - shown,
          projects: seen.map((a) => ({ ...ref(byId('projects', a.project_id)), hours: a.hours_per_week })),
        }
      }),
    }))
  }

  const ALLOWED = {
    team: ['name', 'lead_id'],
    project: ['team_id', 'name', 'description', 'status', 'start_date', 'end_date', 'planned_budget'],
    deliverable: ['name', 'description', 'start_date', 'due_date', 'status', 'depends_on'],
    allocation: ['employee_id', 'project_id', 'hours_per_week', 'start_date', 'end_date'],
  }
  const unknownField = (body, kind) =>
    !body || typeof body !== 'object' || Object.keys(body).some((k) => !ALLOWED[kind].includes(k))

  function checkLead(leadId, teamId) {
    const lead = byId('employees', leadId)
    if (!lead || !active(lead) || !['manager', 'admin'].includes(lead.role)) return err(400, 'invalid_lead')
    if (teamId && lead.team_id === teamId) return err(409, 'lead_cannot_be_member')
    return null
  }
  function nameTaken(name, exceptId) {
    return db.teams.some((t) => active(t) && t.id !== exceptId && t.name.toLowerCase() === name.trim().toLowerCase())
  }
  function wouldCycle(deliverableId, dependsOn) {
    const graph = new Map(db.deliverables.map((d) => [d.id, d.id === deliverableId ? dependsOn : d.depends_on]))
    const path = []
    const visit = (id) => {
      if (path.includes(id)) return [...path.slice(path.indexOf(id)), id]
      path.push(id)
      for (const next of graph.get(id) ?? []) {
        const cycle = visit(next)
        if (cycle) return cycle
      }
      path.pop()
      return null
    }
    return visit(deliverableId)
  }

  // [method, pattern, handler({ body, query, params })]
  return [
    // ---- employees (the parts pages use) ----
    ['GET', /^\/api\/employees\/$/, ({ query }) => {
      if (me().role === 'employee') return forbidden()
      const withArchived = isAdmin() && query.get('include_archived') === 'true'
      return reply(200, { employees: db.employees.filter((e) => withArchived || active(e)).map(employeeView) })
    }],
    ['POST', /^\/api\/employees\/$/, ({ body }) => {
      if (!isAdmin()) return forbidden()
      const row = { ...person(`u-${nextId++}`, body.name, body.role, body.job_title, body.salary), email: body.email }
      db.employees.push(row)
      return reply(201, employeeView(row))
    }],
    ['PUT', /^\/api\/employees\/(?<id>[^/]+)$/, ({ body, params }) => {
      if (!isAdmin()) return forbidden()
      const row = byId('employees', params.id)
      if (!row) return notFound()
      if (body.role === 'employee' && db.teams.some((t) => active(t) && t.lead_id === row.id)) return err(409, 'leads_team')
      Object.assign(row, body)
      return reply(200, employeeView(row))
    }],

    // ---- teams ----
    ['GET', /^\/api\/teams\/$/, ({ query }) => {
      const withArchived = isAdmin() && query.get('include_archived') === 'true'
      const rows = db.teams.filter((t) => (withArchived || active(t)) && canSeeTeam(t))
      return reply(200, { teams: rows.map((t) => teamView(t)) })
    }],
    ['GET', /^\/api\/teams\/(?<id>[^/]+)$/, ({ params }) => {
      const team = visibleTeam(params.id)
      return team ? reply(200, teamView(team, true)) : notFound()
    }],
    ['POST', /^\/api\/teams\/$/, ({ body }) => {
      if (!isAdmin()) return forbidden()
      if (unknownField(body, 'team') || !body.name?.trim()) return err(400, 'bad_request')
      if (nameTaken(body.name)) return err(409, 'name_taken')
      const bad = checkLead(body.lead_id)
      if (bad) return bad
      const team = { id: `t-${nextId++}`, name: body.name.trim(), lead_id: body.lead_id, archived_at: null }
      db.teams.push(team)
      return reply(201, teamView(team, true))
    }],
    ['PUT', /^\/api\/teams\/(?<id>[^/]+)$/, ({ body, params }) => {
      if (!isAdmin()) return forbidden()
      const team = byId('teams', params.id)
      if (!team) return notFound()
      if (unknownField(body, 'team')) return err(400, 'bad_request')
      if (body.name !== undefined && nameTaken(body.name, team.id)) return err(409, 'name_taken')
      if (body.lead_id !== undefined) {
        const bad = checkLead(body.lead_id, team.id)
        if (bad) return bad
      }
      Object.assign(team, body)
      return reply(200, teamView(team, true))
    }],
    ['POST', /^\/api\/teams\/(?<id>[^/]+)\/members$/, ({ body, params }) => {
      if (!isAdmin()) return forbidden()
      const team = byId('teams', params.id)
      if (!team) return notFound()
      const employee = byId('employees', body.employee_id)
      if (!employee || !active(employee)) return err(400, 'invalid_employee')
      if (team.lead_id === employee.id) return err(409, 'lead_cannot_be_member')
      if (employee.team_id === team.id) return err(409, 'already_member')
      if (employee.team_id) return err(409, 'on_other_team')
      employee.team_id = team.id
      return reply(200, teamView(team, true))
    }],
    ['DELETE', /^\/api\/teams\/(?<id>[^/]+)\/members\/(?<employeeId>[^/]+)$/, ({ params }) => {
      if (!isAdmin()) return forbidden()
      const team = byId('teams', params.id)
      const employee = byId('employees', params.employeeId)
      if (!team || !employee || employee.team_id !== team.id) return notFound()
      employee.team_id = null
      return reply(200, teamView(team, true))
    }],
    ['GET', /^\/api\/teams\/(?<id>[^/]+)\/budget$/, ({ params }) => {
      const team = byId('teams', params.id)
      if (!team || !(isAdmin() || team.lead_id === meId)) return team && canSeeTeam(team) ? forbidden() : notFound()
      return reply(200, { team_id: team.id, ...teamMoney(team) })
    }],

    // ---- projects ----
    ['GET', /^\/api\/projects\/$/, ({ query }) => {
      const withArchived = query.get('include_archived') === 'true' && me().role !== 'employee'
      const rows = db.projects.filter((p) => canSeeProject(p) && (withArchived || active(p))
        && (!query.get('team_id') || p.team_id === query.get('team_id'))
        && (!query.get('status') || p.status === query.get('status')))
      return reply(200, { projects: rows.map(projectView) })
    }],
    ['GET', /^\/api\/projects\/(?<id>[^/]+)$/, ({ params }) => {
      const project = visibleProject(params.id)
      return project ? reply(200, projectView(project)) : notFound()
    }],
    ['POST', /^\/api\/projects\/$/, ({ body }) => {
      if (unknownField(body, 'project') || !body.name?.trim()) return err(400, 'bad_request')
      const team = byId('teams', body.team_id)
      if (!team || !active(team)) return err(400, 'invalid_team')
      if (!canManageProject({ team_id: team.id })) return forbidden()
      if (!body.start_date || !body.end_date || body.start_date > body.end_date) return err(400, 'invalid_dates')
      if (badBudget(body.planned_budget)) return err(400, 'bad_request')
      const project = {
        id: `p-${nextId++}`, description: '', status: 'planned', planned_budget: null, ...body, archived_at: null,
      }
      db.projects.push(project)
      return reply(201, projectView(project))
    }],
    ['PUT', /^\/api\/projects\/(?<id>[^/]+)$/, ({ body, params }) => {
      const project = visibleProject(params.id)
      if (!project) return notFound()
      if (!canManageProject(project)) return forbidden()
      if (project.archived_at) return err(409, 'archived')
      if (unknownField(body, 'project') || (body.name !== undefined && !body.name.trim())) return err(400, 'bad_request')
      if (body.team_id !== undefined && !isAdmin()) return forbidden()
      if (badBudget(body.planned_budget)) return err(400, 'bad_request')
      const next = { ...project, ...body }
      if (next.start_date > next.end_date) return err(400, 'invalid_dates')
      if (body.status === 'completed' && db.deliverables.some((d) => active(d) && d.project_id === project.id
        && d.status !== 'done')) return err(409, 'deliverables_open')
      Object.assign(project, body)
      return reply(200, projectView(project))
    }],
    ['POST', /^\/api\/projects\/(?<id>[^/]+)\/archive$/, ({ params }) => {
      const project = visibleProject(params.id)
      if (!project) return notFound()
      if (!canManageProject(project)) return forbidden()
      if (project.archived_at) return err(409, 'already_archived')
      project.archived_at = `${today}T12:00:00+00:00`
      return reply(200, projectView(project))
    }],
    ['GET', /^\/api\/projects\/(?<id>[^/]+)\/budget$/, ({ params }) => {
      const project = visibleProject(params.id)
      if (!project) return notFound()
      if (!canManageProject(project)) return forbidden()
      const money = projectMoney(project)
      const body = { project_id: project.id, ...moneyFields(money), allocated_people: money.people }
      if (isAdmin()) {
        body.lines = money.costs.map((c) => ({
          allocation_id: c.a.id, employee: ref(byId('employees', c.a.employee_id)), hours_per_week: c.a.hours_per_week,
          weeks: c.weeks, hourly_rate: round2(c.rate), committed_cost: round2(c.committed), used_cost_to_date: round2(c.used),
        }))
      }
      return reply(200, body)
    }],

    // ---- deliverables ----
    ['GET', /^\/api\/projects\/(?<id>[^/]+)\/deliverables\/$/, ({ params }) => {
      const project = visibleProject(params.id)
      if (!project) return notFound()
      const rows = db.deliverables.filter((d) => active(d) && d.project_id === project.id)
      return reply(200, { deliverables: rows.map(deliverableView) })
    }],
    ['POST', /^\/api\/projects\/(?<id>[^/]+)\/deliverables\/$/, ({ body, params }) => {
      const project = visibleProject(params.id)
      if (!project) return notFound()
      if (!canManageProject(project)) return forbidden()
      if (unknownField(body, 'deliverable') || !body.name?.trim()) return err(400, 'bad_request')
      if (!body.start_date || !body.due_date || body.start_date > body.due_date
        || body.start_date < project.start_date || body.due_date > project.end_date) return err(400, 'invalid_dates')
      const dependsOn = body.depends_on ?? []
      if (dependsOn.some((id) => byId('deliverables', id)?.project_id !== project.id)) return err(400, 'invalid_dependency')
      const row = {
        id: `d-${nextId++}`, project_id: project.id, description: '', status: 'not_started', completed_at: null,
        ...body, depends_on: dependsOn, archived_at: null,
      }
      db.deliverables.push(row)
      return reply(201, deliverableView(row))
    }],
    ['PUT', /^\/api\/projects\/(?<id>[^/]+)\/deliverables\/(?<did>[^/]+)$/, ({ body, params }) => {
      const project = visibleProject(params.id)
      const row = byId('deliverables', params.did)
      if (!project || !row || row.project_id !== project.id) return notFound()
      if (!canManageProject(project)) return forbidden()
      if (['in_progress', 'done'].includes(body.status)) {
        const pending = row.depends_on.filter((id) => byId('deliverables', id).status !== 'done')
        if (pending.length) return err(409, 'dependencies_not_done', { pending })
      }
      Object.assign(row, body)
      row.completed_at = row.status === 'done' ? (row.completed_at ?? `${today}T12:00:00+00:00`) : null
      return reply(200, deliverableView(row))
    }],
    ['PUT', /^\/api\/projects\/(?<id>[^/]+)\/deliverables\/(?<did>[^/]+)\/dependencies$/, ({ body, params }) => {
      const project = visibleProject(params.id)
      const row = byId('deliverables', params.did)
      if (!project || !row || row.project_id !== project.id) return notFound()
      if (!canManageProject(project)) return forbidden()
      const dependsOn = body.depends_on
      if (dependsOn.includes(row.id)
        || dependsOn.some((id) => byId('deliverables', id)?.project_id !== project.id)) return err(400, 'invalid_dependency')
      const cycle = wouldCycle(row.id, dependsOn)
      if (cycle) return err(409, 'dependency_cycle', { cycle })
      row.depends_on = [...dependsOn]
      return reply(200, deliverableView(row))
    }],

    // ---- allocations ----
    ['GET', /^\/api\/allocations\/$/, ({ query }) => {
      const rows = db.allocations.filter((a) => {
        if (!active(a) && query.get('include_archived') !== 'true') return false
        if (query.get('project_id') && a.project_id !== query.get('project_id')) return false
        if (query.get('employee_id') && a.employee_id !== query.get('employee_id')) return false
        if (isAdmin()) return true
        if (me().role === 'manager') return leads(byId('projects', a.project_id).team_id)
        return a.employee_id === meId
      })
      return reply(200, { allocations: rows.map(allocationView) })
    }],
    ['POST', /^\/api\/allocations\/$/, ({ body }) => {
      if (unknownField(body, 'allocation')) return err(400, 'bad_request')
      const project = visibleProject(body.project_id)
      if (!project) return notFound()
      const employee = byId('employees', body.employee_id)
      if (!employee || !active(employee)) return err(400, 'invalid_employee')
      if (!isAdmin() && !(leads(project.team_id) && employee.team_id === project.team_id)) return forbidden()
      const hours = body.hours_per_week
      if (!Number.isInteger(hours) || hours < 1 || hours > 40) return err(400, 'bad_request')
      if (!body.start_date || !body.end_date || body.start_date > body.end_date
        || body.start_date < project.start_date || body.end_date > project.end_date) return err(400, 'invalid_dates')
      if (project.archived_at || project.status === 'completed') return err(409, 'project_closed')
      const load = weekLoad(employee.id)
      const weeks = weeksTouched(body.start_date, body.end_date)
        .map((week_start) => ({ week_start, hours: (load[week_start] ?? 0) + hours }))
        .filter((w) => w.hours > 40)
      if (weeks.length) return err(409, 'over_allocated', { weeks })
      const row = { id: `a-${nextId++}`, ...body, archived_at: null }
      db.allocations.push(row)
      return reply(201, allocationView(row))
    }],
    ['POST', /^\/api\/allocations\/(?<id>[^/]+)\/archive$/, ({ params }) => {
      const row = byId('allocations', params.id)
      const project = row && visibleProject(row.project_id)
      if (!project) return notFound()
      if (!canManageProject(project)) return forbidden()
      if (row.archived_at) return err(409, 'already_archived')
      row.archived_at = `${today}T12:00:00+00:00`
      return reply(200, allocationView(row))
    }],

    // ---- reports ----
    ['GET', /^\/api\/reports\/project-status$/, ({ query }) => {
      const rows = db.projects.filter((p) => active(p) && canSeeProject(p)
        && (!query.get('team_id') || p.team_id === query.get('team_id'))
        && (!query.get('status') || p.status === query.get('status')))
      return reply(200, {
        projects: rows.map((p) => {
          const ds = db.deliverables.filter((d) => active(d) && d.project_id === p.id).map(deliverableView)
          const count = (status) => ds.filter((d) => d.status === status).length
          const { team, manager, id, name, status, start_date, end_date } = projectView(p)
          return {
            id, name, team, manager, status, start_date, end_date,
            deliverables: {
              total: ds.length, not_started: count('not_started'), in_progress: count('in_progress'), done: count('done'),
              overdue: ds.filter((d) => d.overdue).length, blocked: ds.filter((d) => d.blocked).length,
            },
            percent_complete: ds.length ? round2((count('done') / ds.length) * 100) : 0,
          }
        }),
      })
    }],
    ['GET', /^\/api\/reports\/at-risk-projects$/, () => {
      if (me().role === 'employee') return forbidden()
      const rows = db.projects.filter((p) => active(p) && canSeeProject(p)).map((p) => {
        const ds = db.deliverables.filter((d) => active(d) && d.project_id === p.id).map(deliverableView)
        const reasons = []
        if (p.end_date < today && p.status !== 'completed') reasons.push('past_end_date')
        if (ds.some((d) => d.overdue)) reasons.push('overdue_deliverable')
        if (ds.some((d) => d.blocked && d.start_date < today)) reasons.push('blocked_past_start')
        if (p.status === 'active' && !db.allocations.some((a) => active(a) && a.project_id === p.id
          && mondayOf(a.start_date) <= thisWeek && a.end_date >= thisWeek)) reasons.push('unstaffed')
        if (isAdmin()) {
          if (projectMoney(p).over_budget) reasons.push('over_budget')
        }
        const { id, name, team, manager } = projectView(p)
        return { id, name, team, manager, reasons }
      })
      return reply(200, { projects: rows.filter((r) => r.reasons.length) })
    }],
    ['GET', /^\/api\/reports\/resource-allocation$/, ({ query }) => {
      const weeks = reportWindow(query)
      if (!weeks) return err(400, 'invalid_range')
      return reply(200, { weeks, people: resourceRows(weeks, query.get('team_id')) })
    }],
    ['GET', /^\/api\/reports\/deliverable-status$/, ({ query }) => {
      const rows = db.deliverables
        .filter((d) => active(d) && canSeeProject(byId('projects', d.project_id))
          && (!query.get('project_id') || d.project_id === query.get('project_id'))
          && (!query.get('status') || d.status === query.get('status')))
        .map(deliverableView)
        .filter((d) => query.get('overdue') !== 'true' || d.overdue)
        .sort((a, b) => a.due_date.localeCompare(b.due_date))
      return reply(200, {
        deliverables: rows.map((d) => ({
          id: d.id, name: d.name, project: ref(byId('projects', d.project_id)), status: d.status,
          start_date: d.start_date, due_date: d.due_date, overdue: d.overdue, blocked: d.blocked,
          blocking: db.deliverables.filter((o) => active(o) && o.depends_on.includes(d.id)).map((o) => o.id),
        })),
      })
    }],
    ['GET', /^\/api\/reports\/over-allocated$/, ({ query }) => {
      if (me().role === 'employee') return forbidden()
      const threshold = query.has('threshold') ? Number(query.get('threshold')) : 32
      if (!Number.isInteger(threshold) || threshold < 1 || threshold > 40) return err(400, 'bad_request')
      const weeks = reportWindow(query)
      if (!weeks) return err(400, 'invalid_range')
      const people = resourceRows(weeks)
        .map((p) => ({
          id: p.id, name: p.name,
          weeks: p.weeks.filter((w) => w.total_hours > threshold)
            .map(({ week_start, total_hours }) => ({ week_start, total_hours })),
        }))
        .filter((p) => p.weeks.length)
      return reply(200, { label: 'near capacity', threshold, people })
    }],
    ['GET', /^\/api\/reports\/dependency-chain$/, ({ query }) => {
      if (!query.get('project_id')) return err(400, 'bad_request')
      const project = visibleProject(query.get('project_id'))
      if (!project) return notFound()
      const ds = db.deliverables.filter((d) => active(d) && d.project_id === project.id)
      const depth = new Map()
      const depthOf = (d) => {
        if (!depth.has(d.id)) {
          depth.set(d.id, d.depends_on.length
            ? 1 + Math.max(...d.depends_on.map((id) => depthOf(byId('deliverables', id)))) : 0)
        }
        return depth.get(d.id)
      }
      ds.forEach(depthOf)
      const order = [...ds].sort((a, b) => depth.get(a.id) - depth.get(b.id)).map((d) => d.id)
      const chain = []
      let cursor = [...ds].sort((a, b) => depth.get(b.id) - depth.get(a.id))[0]
      while (cursor) {
        chain.unshift(cursor.id)
        const parents = cursor.depends_on.map((id) => byId('deliverables', id))
        cursor = parents.sort((a, b) => depth.get(b.id) - depth.get(a.id))[0]
      }
      return reply(200, {
        project_id: project.id,
        nodes: ds.map(({ id, name, status, start_date, due_date }) => ({ id, name, status, start_date, due_date, depth: depth.get(id) })),
        edges: ds.flatMap((d) => d.depends_on.map((from) => ({ from, to: d.id }))),
        order, longest_chain: chain,
      })
    }],
    ['GET', /^\/api\/reports\/budget$/, ({ query }) => {
      if (me().role === 'employee') return forbidden()
      const teamId = query.get('team_id')
      const projects = db.projects.filter((p) => active(p) && canSeeProject(p) && (!teamId || p.team_id === teamId))
      const teams = db.teams.filter((t) => active(t) && canSeeTeam(t) && (!teamId || t.id === teamId))
      return reply(200, {
        projects: projects.map((p) => {
          return { id: p.id, name: p.name, team: ref(byId('teams', p.team_id)), ...moneyFields(projectMoney(p)) }
        }),
        teams: teams.map((t) => {
          const { weekly, yearly, hidden_reason } = teamMoney(t)
          return { id: t.id, name: t.name, weekly, yearly, hidden_reason }
        }),
      })
    }],
  ]
}

/**
 * Sign in as a role ('admin' | 'manager' | 'employee') or a user id (e.g. 'u-6'),
 * by storing a refresh token the fake auth server accepts, and serve the API.
 */
export function signedInAs(who, { db = seedData(), routes = {}, today = TODAY } = {}) {
  window.localStorage.setItem(REFRESH_TOKEN_KEY, 'stored-refresh')
  const meId = USER_FOR_ROLE[who] ?? who
  const api = createApi(db, meId, today)
  let refreshes = 0
  const handlers = new Proxy({
    'POST /api/auth/refresh': () => {
      refreshes += 1
      return reply(200, { access_token: `access-${refreshes}`, refresh_token: `refresh-${refreshes}` })
    },
    'GET /api/auth/me': () => {
      const { id, email, name, role, job_title } = db.employees.find((e) => e.id === meId)
      return reply(200, { id, email, name, role, job_title })
    },
    ...routes,
  }, {
    // Unknown exact routes fall through to the contract routes above.
    get(target, key) {
      if (key in target) return target[key]
      const [method, path] = String(key).split(' ')
      for (const [m, pattern, handler] of api) {
        const match = m === method && pattern.exec(path)
        if (match) {
          return (body) => {
            const call = server.calls.at(-1)
            return handler({ body, params: match.groups ?? {}, query: new URLSearchParams(call.query) })
          }
        }
      }
      return undefined
    },
  })
  const server = { ...fakeAuthServer(handlers), db }
  return server
}
