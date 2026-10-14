import { describe, expect, it, vi } from 'vitest'
import { API_URL, ApiError, request, toQuery } from './apiClient'
import * as allocations from './allocationService'
import * as budgets from './budgetService'
import * as projects from './projectService'
import * as reports from './reportService'
import * as teams from './teamService'

/** Replace global fetch with a mock that answers with (status, JSON body). */
function mockFetch(status, body, { invalidJson = false } = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (invalidJson) throw new SyntaxError('Unexpected token <')
      return body
    },
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function lastCall(fetchMock) {
  const [url, init] = fetchMock.mock.calls.at(-1)
  return { url, init, body: init.body === undefined ? undefined : JSON.parse(init.body) }
}

describe('apiClient', () => {
  it('talks to the local API by default', () => {
    expect(API_URL).toBe('http://localhost:3001/api')
  })

  it('toQuery keeps only set values', () => {
    expect(toQuery({ a: 'x', b: undefined, c: null, d: '', e: false, f: true, g: 0 })).toBe('?a=x&f=true&g=0')
    expect(toQuery({})).toBe('')
    expect(toQuery()).toBe('')
  })

  it('sends the bearer token, and JSON only when there is a body', async () => {
    const fetchMock = mockFetch(200, { ok: 1 })
    await request('/teams/', 'tok')
    expect(lastCall(fetchMock).init.headers).toEqual({ Accept: 'application/json', Authorization: 'Bearer tok' })

    await request('/teams/', null, { method: 'POST', body: { a: 1 } })
    const { init, body } = lastCall(fetchMock)
    expect(init.headers).toEqual({ Accept: 'application/json', 'Content-Type': 'application/json' })
    expect(body).toEqual({ a: 1 })
  })

  it('an error keeps status, code and structured details, never the server message', async () => {
    const weeks = [{ week_start: '2026-11-09', hours: 48 }]
    mockFetch(409, { error: { code: 'over_allocated', message: 'raw server text', details: { weeks } } })

    const error = await request('/allocations/', 't', { method: 'POST', body: {} }).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 409, code: 'over_allocated', details: { weeks } })
    expect(error.message).not.toContain('raw server text')
  })

  it('ignores details that are not an object', async () => {
    mockFetch(409, { error: { code: 'archived', details: 'text' } })
    await expect(request('/x', 't')).rejects.toMatchObject({ code: 'archived', details: null })
  })

  it('an error without a JSON body still rejects with its status', async () => {
    mockFetch(502, null, { invalidJson: true })
    await expect(request('/x', 't')).rejects.toMatchObject({ status: 502, code: 'unknown_error', details: null })
  })

  it('a network failure rejects with status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(request('/x', 't')).rejects.toMatchObject({ status: 0, code: 'network_error' })
  })
})

// [name, call, method, path (after /api), body]
const ENDPOINTS = [
  ['listTeams', (t) => teams.listTeams(t), 'GET', '/teams/'],
  ['listTeams archived', (t) => teams.listTeams(t, { includeArchived: true }), 'GET', '/teams/?include_archived=true'],
  ['getTeam', (t) => teams.getTeam(t, 'a/b'), 'GET', '/teams/a%2Fb'],
  ['createTeam', (t) => teams.createTeam(t, { name: 'P', lead_id: 'm' }), 'POST', '/teams/', { name: 'P', lead_id: 'm' }],
  ['updateTeam', (t) => teams.updateTeam(t, 'tm', { lead_id: 'm' }), 'PUT', '/teams/tm', { lead_id: 'm' }],
  ['addMember', (t) => teams.addMember(t, 'tm', 'e'), 'POST', '/teams/tm/members', { employee_id: 'e' }],
  ['removeMember', (t) => teams.removeMember(t, 'tm', 'e'), 'DELETE', '/teams/tm/members/e'],
  ['archiveTeam', (t) => teams.archiveTeam(t, 'tm'), 'POST', '/teams/tm/archive'],

  ['listProjects', (t) => projects.listProjects(t), 'GET', '/projects/'],
  ['listProjects filtered', (t) => projects.listProjects(t, { teamId: 'tm', status: 'active', includeArchived: true }),
    'GET', '/projects/?team_id=tm&status=active&include_archived=true'],
  ['getProject', (t) => projects.getProject(t, 'p'), 'GET', '/projects/p'],
  ['createProject', (t) => projects.createProject(t, { name: 'X' }), 'POST', '/projects/', { name: 'X' }],
  ['updateProject', (t) => projects.updateProject(t, 'p', { status: 'active' }), 'PUT', '/projects/p', { status: 'active' }],
  ['archiveProject', (t) => projects.archiveProject(t, 'p'), 'POST', '/projects/p/archive'],
  ['listDeliverables', (t) => projects.listDeliverables(t, 'p'), 'GET', '/projects/p/deliverables/'],
  ['createDeliverable', (t) => projects.createDeliverable(t, 'p', { name: 'D' }), 'POST', '/projects/p/deliverables/', { name: 'D' }],
  ['updateDeliverable', (t) => projects.updateDeliverable(t, 'p', 'd', { status: 'done' }), 'PUT',
    '/projects/p/deliverables/d', { status: 'done' }],
  ['setDependencies', (t) => projects.setDependencies(t, 'p', 'd', ['d2']), 'PUT',
    '/projects/p/deliverables/d/dependencies', { depends_on: ['d2'] }],
  ['archiveDeliverable', (t) => projects.archiveDeliverable(t, 'p', 'd'), 'POST', '/projects/p/deliverables/d/archive'],

  ['listAllocations', (t) => allocations.listAllocations(t, { projectId: 'p', from: '2026-11-02' }),
    'GET', '/allocations/?project_id=p&from=2026-11-02'],
  ['createAllocation', (t) => allocations.createAllocation(t, { hours_per_week: 8 }), 'POST', '/allocations/', { hours_per_week: 8 }],
  ['updateAllocation', (t) => allocations.updateAllocation(t, 'a', { hours_per_week: 4 }), 'PUT', '/allocations/a', { hours_per_week: 4 }],
  ['archiveAllocation', (t) => allocations.archiveAllocation(t, 'a'), 'POST', '/allocations/a/archive'],

  ['getTeamBudget', (t) => budgets.getTeamBudget(t, 'tm'), 'GET', '/teams/tm/budget'],
  ['getProjectBudget', (t) => budgets.getProjectBudget(t, 'p'), 'GET', '/projects/p/budget'],

  ['projectStatus', (t) => reports.projectStatus(t, { teamId: 'tm', status: 'active' }), 'GET',
    '/reports/project-status?team_id=tm&status=active'],
  ['atRiskProjects', (t) => reports.atRiskProjects(t), 'GET', '/reports/at-risk-projects'],
  ['resourceAllocation', (t) => reports.resourceAllocation(t, { from: '2026-11-02', to: '2026-12-28', teamId: 'tm' }),
    'GET', '/reports/resource-allocation?from=2026-11-02&to=2026-12-28&team_id=tm'],
  ['deliverableStatus', (t) => reports.deliverableStatus(t, { projectId: 'p', overdue: true }), 'GET',
    '/reports/deliverable-status?project_id=p&overdue=true'],
  ['overAllocated', (t) => reports.overAllocated(t, { threshold: 30 }), 'GET', '/reports/over-allocated?threshold=30'],
  ['dependencyChain', (t) => reports.dependencyChain(t, { projectId: 'p', deliverableId: 'd' }), 'GET',
    '/reports/dependency-chain?project_id=p&deliverable_id=d'],
  ['budgetReport', (t) => reports.budgetReport(t), 'GET', '/reports/budget'],
]

describe.each(ENDPOINTS)('%s', (name, call, method, path, body) => {
  it(`${method} ${path}`, async () => {
    const fetchMock = mockFetch(200, { teams: [], projects: [], deliverables: [], allocations: [] })
    await call('access.jwt')
    const sent = lastCall(fetchMock)
    expect(sent.url).toBe(`${API_URL}${path}`)
    expect(sent.init.method).toBe(method)
    expect(sent.init.headers.Authorization).toBe('Bearer access.jwt')
    expect(sent.body).toEqual(body)
  })
})

describe('list functions unwrap the list', () => {
  it.each([
    ['teams', () => teams.listTeams('t')],
    ['projects', () => projects.listProjects('t')],
    ['deliverables', () => projects.listDeliverables('t', 'p')],
    ['allocations', () => allocations.listAllocations('t')],
  ])('%s', async (key, call) => {
    mockFetch(200, { [key]: [{ id: 1 }] })
    await expect(call()).resolves.toEqual([{ id: 1 }])
  })

  it('reports and single records are returned as they come', async () => {
    mockFetch(200, { weeks: [], people: [] })
    await expect(reports.resourceAllocation('t')).resolves.toEqual({ weeks: [], people: [] })
  })
})
