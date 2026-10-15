import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { reply, seedData, signedInAs } from '../test/fakeApiServer'
import { choose, renderApp } from '../test/renderApp'

// Seed (test/fakeApiServer.js): Platform (t-1, led by Max Manager) has Eve, Bo and Cy;
// Data (t-2, led by Mia Manager) has Dee; Ada Admin, Max, Mia and Nia New are on no team.
const namesIn = (table) => within(table).getAllByRole('rowheader').map((cell) => cell.textContent)
const searchFor = (user, label, text) => user.type(screen.getByRole('searchbox', { name: label }), text)
const team = (id, name) => ({ id, name })

describe('Employees: search, role and team', () => {
  it('search matches name, email, job title or team; filters combine; no match says why', async () => {
    signedInAs('admin')
    const { user } = renderApp('/employees')
    const table = await screen.findByRole('table', { name: 'Employees' })
    expect(within(table).getAllByRole('rowheader')).toHaveLength(8)

    await searchFor(user, 'Search employees', 'engineer') // job title
    expect(namesIn(table)).toEqual(['Eve Employee', 'Bo Builder'])

    await user.clear(screen.getByRole('searchbox', { name: 'Search employees' }))
    await choose(user, 'Role', 'Manager')
    expect(namesIn(table)).toEqual(['Max Manager', 'Mia Manager'])

    await choose(user, 'Role', 'All roles')
    await choose(user, 'Team', 'No team')
    expect(namesIn(table)).toEqual(['Ada Admin', 'Max Manager', 'Mia Manager', 'Nia New'])

    await choose(user, 'Team', 'Platform')
    await searchFor(user, 'Search employees', 'zzz')
    expect(within(table).getByRole('cell', { name: "No employees match 'zzz'." })).toBeInTheDocument()
  })

  it('a filter on a later page starts again at page 1', async () => {
    const db = seedData()
    for (let i = 1; i <= 40; i += 1) {
      db.employees.push({ id: `x-${i}`, name: `Person ${i}`, role: 'employee', job_title: 'Engineer', salary: 80000,
        team_id: null, email: `p${i}@acme.test`, archived_at: null })
    }
    signedInAs('admin', { db })
    const { user } = renderApp('/employees')
    await screen.findByRole('table', { name: 'Employees' })
    await user.click(within(screen.getByRole('navigation', { name: 'Employees pages' }))
      .getByRole('button', { name: 'Go to next page' }))
    await searchFor(user, 'Search employees', 'Person 1') // Person 1, 10-19
    expect(screen.getAllByRole('rowheader')).toHaveLength(11)
    expect(screen.queryByRole('navigation', { name: 'Employees pages' })).not.toBeInTheDocument()
  })

  it('a manager gets search, role and team, but not "Show archived"', async () => {
    signedInAs('manager')
    renderApp('/employees')
    const bar = await screen.findByRole('search', { name: 'Filter employees' })
    expect(within(bar).getByRole('searchbox', { name: 'Search employees' })).toBeInTheDocument()
    expect(within(bar).getByRole('combobox', { name: 'Team' })).toBeInTheDocument()
    expect(within(bar).queryByRole('switch', { name: 'Show archived' })).not.toBeInTheDocument()
  })
})

describe('Teams: search', () => {
  it('matches the team, its lead or a member', async () => {
    signedInAs('admin')
    const { user } = renderApp('/teams')
    const cards = await screen.findByRole('list', { name: 'Teams' })
    const teamNames = () => within(screen.getByRole('list', { name: 'Teams' })).getAllByRole('heading')
      .map((h) => h.textContent)
    expect(within(cards).getAllByRole('listitem')).toHaveLength(2)

    await searchFor(user, 'Search teams', 'mia') // Data's lead
    expect(teamNames()).toEqual(['Data'])
    await user.clear(screen.getByRole('searchbox', { name: 'Search teams' }))
    await searchFor(user, 'Search teams', 'bo builder') // a Platform member
    await waitFor(() => expect(teamNames()).toEqual(['Platform']))
    await user.clear(screen.getByRole('searchbox', { name: 'Search teams' }))
    await searchFor(user, 'Search teams', 'qq')
    expect(screen.getByText("No teams match 'qq'.")).toBeInTheDocument()
  })
})

describe('Reports: every tab can be searched and filtered', () => {
  it('project status: search, status and team', async () => {
    const row = (id, name, t, status) => ({ id, name, team: t, status, percent_complete: 50,
      deliverables: { done: 1, in_progress: 1, not_started: 0, total: 2, overdue: 0, blocked: 0 } })
    signedInAs('admin', { routes: { 'GET /api/reports/project-status': () => reply(200, { projects: [
      row('a', 'Billing v2', team('t-1', 'Platform'), 'active'), row('b', 'Data Lake', team('t-2', 'Data'), 'planned'),
      row('c', 'Billing export', team('t-2', 'Data'), 'active'),
    ] }) } })
    const { user } = renderApp('/reports?tab=project-status')
    const table = await screen.findByRole('table', { name: 'Project status' })
    await searchFor(user, 'Search projects', 'billing')
    expect(namesIn(table)).toEqual(['Billing v2', 'Billing export'])
    await choose(user, 'Team', 'Data')
    expect(namesIn(table)).toEqual(['Billing export'])
    await choose(user, 'Status', 'Planned')
    expect(screen.getByText("No projects match 'billing'.")).toBeInTheDocument()
  })

  it('at-risk: reason and team', async () => {
    const row = (id, name, t, reasons) => ({ id, name, team: t, manager: { id: 'u-2', name: 'Max Manager' }, reasons })
    signedInAs('admin', { routes: { 'GET /api/reports/at-risk-projects': () => reply(200, { projects: [
      row('a', 'Late one', team('t-1', 'Platform'), ['past_end_date']),
      row('b', 'Costly one', team('t-2', 'Data'), ['over_budget', 'unstaffed']),
    ] }) } })
    const { user } = renderApp('/reports?tab=at-risk')
    await screen.findByRole('list', { name: 'At-risk projects' })
    const titles = () => within(screen.getByRole('list', { name: 'At-risk projects' })).getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent)
    await choose(user, 'Reason', 'Over budget')
    expect(titles()).toEqual(['Costly one'])
    await choose(user, 'Team', 'Platform')
    expect(screen.getByText('No at-risk projects match these filters.')).toBeInTheDocument()
  })

  it('deliverables: search the deliverable or its project, and status', async () => {
    const row = (id, name, project, status) => ({ id, name, project, status, start_date: '2026-11-02',
      due_date: '2026-11-20', overdue: false, blocked: false, blocking: [] })
    signedInAs('admin', { routes: { 'GET /api/reports/deliverable-status': () => reply(200, { deliverables: [
      row('a', 'API spec', team('p-1', 'Billing v2'), 'done'), row('b', 'Build', team('p-1', 'Billing v2'), 'in_progress'),
      row('c', 'Ingest', team('p-2', 'Data Lake'), 'in_progress'),
    ] }) } })
    const { user } = renderApp('/reports?tab=deliverables')
    const table = await screen.findByRole('table', { name: 'Deliverable status' })
    await searchFor(user, 'Search deliverables', 'billing')
    expect(namesIn(table)).toEqual(['API spec', 'Build'])
    await choose(user, 'Status', 'In progress')
    expect(namesIn(table)).toEqual(['Build'])
    expect(screen.getByRole('switch', { name: 'Only overdue' })).toBeInTheDocument()
  })

  it('near capacity: search people next to the threshold', async () => {
    const person = (id, name) => ({ id, name, weeks: [{ week_start: '2026-11-09', total_hours: 38 }] })
    signedInAs('admin', { routes: { 'GET /api/reports/over-allocated': () => reply(200, {
      label: 'near capacity', threshold: 32, people: [person('a', 'Ana Silva'), person('b', 'Bo Chen')],
    }) } })
    const { user } = renderApp('/reports?tab=near-capacity')
    const table = await screen.findByRole('table', { name: 'Near capacity' })
    const bar = screen.getByRole('search', { name: 'Filter near capacity' })
    expect(within(bar).getByRole('textbox', { name: 'Threshold (hours per week)' })).toBeInTheDocument()
    await searchFor(user, 'Search people', 'bo')
    expect(namesIn(table)).toEqual(['Bo Chen'])
  })

  it('resource allocation: search people and pick a team (or no team)', async () => {
    const person = (id, name, teamId) => ({ id, name, team_id: teamId, weeks: [] })
    signedInAs('admin', { routes: { 'GET /api/reports/resource-allocation': () => reply(200, {
      weeks: ['2026-11-09'],
      people: [person('u-3', 'Eve Employee', 't-1'), person('u-7', 'Dee Data', 't-2'), person('u-8', 'Nia New', null)],
    }) } })
    const { user } = renderApp('/reports?tab=resources')
    const heat = await screen.findByRole('table', { name: 'Resource allocation' })
    await choose(user, 'Team', 'No team')
    expect(namesIn(heat)).toEqual(['Nia New'])
    await choose(user, 'Team', 'Data')
    expect(namesIn(heat)).toEqual(['Dee Data'])
    await choose(user, 'Team', 'All teams')
    await searchFor(user, 'Search people', 'eve')
    expect(namesIn(heat)).toEqual(['Eve Employee'])
  })

  it('budget: one search for both tables, a team, and only the over-budget projects', async () => {
    const project = (id, name, t, over) => ({ id, name, team: t, planned_budget: 1000, committed_cost: over ? 1200 : 500,
      used_cost_to_date: 100, percent_used: 10, over_budget: over, hidden_reason: null })
    signedInAs('admin', { routes: { 'GET /api/reports/budget': () => reply(200, {
      projects: [project('a', 'Billing v2', team('t-1', 'Platform'), true), project('b', 'Data Lake', team('t-2', 'Data'), false)],
      teams: [{ id: 't-1', name: 'Platform', weekly: 100, yearly: 5200, hidden_reason: null },
        { id: 't-2', name: 'Data', weekly: 90, yearly: 4680, hidden_reason: null }],
    }) } })
    const { user } = renderApp('/reports?tab=budget')
    const projects = await screen.findByRole('table', { name: 'Project budgets' })
    const teams = screen.getByRole('table', { name: 'Team budgets' })
    await searchFor(user, 'Search budgets', 'data')
    expect(namesIn(projects)).toEqual(['Data Lake'])
    expect(namesIn(teams)).toEqual(['Data'])
    await user.clear(screen.getByRole('searchbox', { name: 'Search budgets' }))
    await user.click(screen.getByRole('switch', { name: 'Only over budget' }))
    expect(namesIn(projects)).toEqual(['Billing v2'])
    expect(namesIn(teams)).toEqual(['Platform', 'Data']) // teams have no over-budget flag
    await choose(user, 'Team', 'Data')
    expect(screen.getByText('No projects match these filters.')).toBeInTheDocument()
  })

  it('dependencies: type to find the project', async () => {
    signedInAs('admin')
    const { user } = renderApp('/reports?tab=dependencies')
    const picker = await screen.findByRole('combobox', { name: 'Project' })
    await user.type(picker, 'lake')
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Data Lake'])
    await user.clear(picker)
    await user.type(picker, 'nothing like it')
    expect(screen.getByText('No projects match.')).toBeInTheDocument()
  })
})
