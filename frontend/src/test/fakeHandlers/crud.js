// Fake routes for the edit and archive actions on the project and team pages
// (docs/api-contract.md §3, §5, §6): deliverable archive, allocation edit, team archive.
// Same visibility and money rules as fakeApiServer.js, rebuilt from db, me() and today.
import { reply } from '../fakeAuthServer'

const DAY = 86400000
const toTime = (date) => Date.parse(`${date}T00:00:00Z`)
const toDate = (time) => new Date(time).toISOString().slice(0, 10)
const mondayOf = (date) => toDate(toTime(date) - ((new Date(toTime(date)).getUTCDay() + 6) % 7) * DAY)
function weeksTouched(start, end) {
  const weeks = []
  for (let t = toTime(mondayOf(start)); t <= toTime(end); t += 7 * DAY) weeks.push(toDate(t))
  return weeks
}
const round2 = (n) => Math.round(n * 100) / 100
const err = (status, code, details) =>
  reply(status, { error: { code, message: `Server text for ${code}.`, ...(details ? { details } : {}) } })

/** The helpers each handler needs, for one request. */
function helpers({ db, me, today }) {
  const active = (row) => !row.archived_at
  const byId = (table, id) => db[table].find((row) => row.id === id)
  const ref = (row) => (row ? { id: row.id, name: row.name } : null)
  const isAdmin = () => me().role === 'admin'
  const leads = (teamId) => db.teams.some((t) => active(t) && t.id === teamId && t.lead_id === me().id)
  const canSeeProject = (p) => isAdmin() || (me().role === 'manager' ? leads(p.team_id)
    : db.allocations.some((a) => active(a) && a.employee_id === me().id && a.project_id === p.id))
  const visibleProject = (id) => {
    const project = byId('projects', id)
    return project && canSeeProject(project) ? project : null
  }
  const canManageProject = (p) => isAdmin() || leads(p.team_id)
  const deliverableView = (d) => ({
    ...d, depends_on: [...d.depends_on],
    blocked: d.depends_on.some((id) => byId('deliverables', id).status !== 'done'),
    overdue: d.due_date < today && d.status !== 'done',
  })
  function allocationView(a) {
    const view = {
      id: a.id, employee: ref(byId('employees', a.employee_id)), project: ref(byId('projects', a.project_id)),
      hours_per_week: a.hours_per_week, start_date: a.start_date, end_date: a.end_date, archived_at: a.archived_at,
    }
    if (!isAdmin()) return view
    const rate = byId('employees', a.employee_id).salary / 2080
    return { ...view, hourly_rate: round2(rate), weekly_cost: round2(rate * a.hours_per_week) }
  }
  const members = (teamId) => db.employees.filter((e) => active(e) && e.team_id === teamId)
  const teamView = (t) => ({
    id: t.id, name: t.name, lead: ref(byId('employees', t.lead_id)), member_count: members(t.id).length,
    archived_at: t.archived_at,
    members: members(t.id).map(({ id, name, job_title, role }) => ({ id, name, job_title, role })),
  })
  function weekLoad(employeeId, skipId) {
    const load = {}
    for (const a of db.allocations) {
      if (!active(a) || a.employee_id !== employeeId || a.id === skipId) continue
      for (const w of weeksTouched(a.start_date, a.end_date)) load[w] = (load[w] ?? 0) + a.hours_per_week
    }
    return load
  }
  return {
    active, byId, isAdmin, leads, visibleProject, canManageProject, deliverableView, allocationView, teamView, weekLoad,
  }
}

const notFound = () => err(404, 'not_found')
const forbidden = () => err(403, 'forbidden')
const EDITABLE = ['hours_per_week', 'start_date', 'end_date']

export const crudRoutes = [
  ['POST', /^\/api\/projects\/(?<id>[^/]+)\/deliverables\/(?<did>[^/]+)\/archive$/, ({ params, ...context }) => {
    const h = helpers(context)
    const project = h.visibleProject(params.id)
    const row = h.byId('deliverables', params.did)
    if (!project || !row || row.project_id !== project.id) return notFound()
    if (!h.canManageProject(project)) return forbidden()
    if (project.archived_at) return err(409, 'archived')
    if (row.archived_at) return err(409, 'already_archived')
    if (context.db.deliverables.some((d) => h.active(d) && d.depends_on.includes(row.id))) return err(409, 'has_dependents')
    row.archived_at = `${context.today}T12:00:00+00:00`
    return reply(200, h.deliverableView(row))
  }],

  ['PUT', /^\/api\/allocations\/(?<id>[^/]+)$/, ({ body, params, ...context }) => {
    const h = helpers(context)
    const row = h.byId('allocations', params.id)
    const project = row && h.visibleProject(row.project_id)
    if (!project) return notFound()
    const employee = h.byId('employees', row.employee_id)
    if (!h.isAdmin() && !(h.leads(project.team_id) && employee.team_id === project.team_id)) return forbidden()
    if (!body || typeof body !== 'object' || Object.keys(body).some((k) => !EDITABLE.includes(k))) {
      return err(400, 'bad_request')
    }
    if (row.archived_at) return err(409, 'archived')
    const next = { ...row, ...body }
    if (!Number.isInteger(next.hours_per_week) || next.hours_per_week < 1 || next.hours_per_week > 40) {
      return err(400, 'bad_request')
    }
    if (next.start_date > next.end_date || next.start_date < project.start_date
      || next.end_date > project.end_date) return err(400, 'invalid_dates')
    if (project.archived_at || project.status === 'completed') return err(409, 'project_closed')
    if (context.db.allocations.some((a) => h.active(a) && a.id !== row.id && a.employee_id === row.employee_id
      && a.project_id === row.project_id && a.start_date <= next.end_date && a.end_date >= next.start_date)) {
      return err(409, 'overlapping_allocation')
    }
    // PUT re-runs the 40-hour check without counting the allocation itself (§6).
    const load = h.weekLoad(row.employee_id, row.id)
    const weeks = weeksTouched(next.start_date, next.end_date)
      .map((week_start) => ({ week_start, hours: (load[week_start] ?? 0) + next.hours_per_week }))
      .filter((w) => w.hours > 40)
    if (weeks.length) return err(409, 'over_allocated', { weeks })
    Object.assign(row, body)
    return reply(200, h.allocationView(row))
  }],

  ['POST', /^\/api\/teams\/(?<id>[^/]+)\/archive$/, ({ params, ...context }) => {
    const h = helpers(context)
    if (!h.isAdmin()) return forbidden()
    const team = h.byId('teams', params.id)
    if (!team) return notFound()
    if (team.archived_at) return err(409, 'already_archived')
    if (context.db.projects.some((p) => h.active(p) && p.team_id === team.id)) return err(409, 'has_active_projects')
    team.archived_at = `${context.today}T12:00:00+00:00`
    context.db.employees.filter((e) => e.team_id === team.id).forEach((e) => { e.team_id = null })
    return reply(200, h.teamView(team))
  }],
]
