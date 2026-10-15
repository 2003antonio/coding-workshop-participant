import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { reply, signedInAs } from '../test/fakeApiServer'
import { choose, renderApp } from '../test/renderApp'

// Seed (test/fakeApiServer.js): Platform (t-1) has Eve, Bo and Cy; Data (t-2) has Dee;
// Ada Admin, Max Manager, Mia Manager and Nia New are on no team.
async function openCard(user, name) {
  const card = await screen.findByRole('region', { name })
  await waitFor(() => expect(within(card).queryByRole('status')).not.toBeInTheDocument())
  await user.click(within(card).getByRole('link', { name }))
}
const namesIn = (table) => within(table).getAllByRole('rowheader').map((cell) => cell.textContent)

describe('Home numbers open their list with the filter already on', () => {
  it('"Overdue deliverables" opens the deliverable report with "Only overdue" on', async () => {
    const server = signedInAs('admin')
    const { user } = renderApp('/')
    await openCard(user, 'Overdue deliverables')
    expect(await screen.findByRole('tab', { name: 'Deliverables', selected: true })).toBeInTheDocument()
    expect(await screen.findByRole('switch', { name: 'Only overdue' })).toBeChecked()
    await screen.findByRole('table', { name: 'Deliverable status' })
    expect(server.calls.filter((c) => c.path === '/api/reports/deliverable-status').at(-1).query).toBe('?overdue=true')
  })

  it('"Over budget" opens the budget report showing only the over-budget projects', async () => {
    const project = (id, name, over) => ({ id, name, team: { id: 't-1', name: 'Platform' }, planned_budget: 1000,
      committed_cost: over ? 1200 : 500, used_cost_to_date: 100, percent_used: 10, over_budget: over, hidden_reason: null })
    signedInAs('admin', { routes: { 'GET /api/reports/budget': () => reply(200, {
      projects: [project('a', 'Billing v2', true), project('b', 'Data Lake', false)], teams: [],
    }) } })
    const { user } = renderApp('/')
    await openCard(user, 'Over budget')
    expect(await screen.findByRole('switch', { name: 'Only over budget' })).toBeChecked()
    expect(namesIn(await screen.findByRole('table', { name: 'Project budgets' }))).toEqual(['Billing v2'])
  })

  it('"Active projects" opens Projects filtered to active', async () => {
    signedInAs('admin')
    const { user } = renderApp('/')
    await openCard(user, 'Active projects')
    const bar = await screen.findByRole('search', { name: 'Filter projects' })
    expect(within(bar).getByRole('combobox', { name: 'Status' })).toHaveTextContent('Active')
  })

  it('the portfolio-health legend links "At risk" and "Over budget" to those lists', async () => {
    const team = { id: 't-1', name: 'Platform' }
    signedInAs('admin', { routes: {
      'GET /api/reports/at-risk-projects': () => reply(200, { projects: [
        { id: 'p-1', name: 'Billing v2', team, manager: null, reasons: ['overdue_deliverable'] }] }),
      'GET /api/reports/budget': () => reply(200, { teams: [], projects: [
        { id: 'p-2', name: 'Data Lake', team, planned_budget: 1000, committed_cost: 1500, used_cost_to_date: 100,
          percent_used: 10, over_budget: true, hidden_reason: null }] }),
    } })
    renderApp('/')
    const legend = await screen.findByRole('list', { name: 'Projects by health' })
    expect(within(legend).getByRole('link', { name: /^At risk/ })).toHaveAttribute('href', '/reports?tab=at-risk')
    expect(within(legend).getByRole('link', { name: /^Over budget/ })).toHaveAttribute('href', '/reports?tab=budget&over=1')
    expect(within(legend).queryByRole('link', { name: /^Healthy/ })).not.toBeInTheDocument() // no list of healthy ones
  })

  it("an employee's Overdue tile opens the deliverable report with overdue on", async () => {
    signedInAs('employee')
    renderApp('/')
    const tile = await screen.findByRole('region', { name: 'Overdue' })
    expect(within(tile).getByRole('link', { name: 'Overdue' })).toHaveAttribute('href', '/reports?tab=deliverables&overdue=1')
  })
})

describe('Any filtered address can be opened directly (a shared link, a refresh)', () => {
  it('Employees: ?role=manager&team=none', async () => {
    signedInAs('admin')
    renderApp('/employees?role=manager&team=none')
    const table = await screen.findByRole('table', { name: 'Employees' })
    await waitFor(() => expect(namesIn(table)).toEqual(['Max Manager', 'Mia Manager']))
    expect(screen.getByRole('combobox', { name: 'Role' })).toHaveTextContent('Manager')
    expect(screen.getByRole('combobox', { name: 'Team' })).toHaveTextContent('No team')
  })

  it('Projects: ?team= goes to the server, and the dropdown shows it once teams load', async () => {
    const server = signedInAs('admin')
    renderApp('/projects?team=t-2')
    const table = await screen.findByRole('table', { name: 'Projects' })
    expect(namesIn(table)).toEqual(['Data Lake'])
    expect(server.calls.find((c) => c.path === '/api/projects/').query).toContain('team_id=t-2')
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Team' })).toHaveTextContent('Data'))
  })

  it('a team the caller cannot see is ignored, not shown as an empty list', async () => {
    signedInAs('admin')
    renderApp('/employees?team=no-such-team')
    const table = await screen.findByRole('table', { name: 'Employees' })
    expect(within(table).getAllByRole('rowheader')).toHaveLength(8)
    expect(screen.getByRole('combobox', { name: 'Team' })).not.toHaveTextContent(/\w/) // nothing chosen
  })

  it('Reports: ?reason= on the at-risk tab; switching tabs starts with no filters', async () => {
    const row = (id, name, reasons) => ({ id, name, team: { id: 't-1', name: 'Platform' }, manager: null, reasons })
    signedInAs('admin', { routes: { 'GET /api/reports/at-risk-projects': () => reply(200, { projects: [
      row('a', 'Late one', ['past_end_date']), row('b', 'Costly one', ['over_budget']),
    ] }) } })
    const { user } = renderApp('/reports?tab=at-risk&reason=over_budget')
    const list = await screen.findByRole('list', { name: 'At-risk projects' })
    expect(within(list).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Costly one'])
    expect(screen.getByRole('combobox', { name: 'Reason' })).toHaveTextContent('Over budget')

    await user.click(screen.getByRole('tab', { name: 'Deliverables' }))
    expect(await screen.findByRole('switch', { name: 'Only overdue' })).not.toBeChecked()
    await choose(user, 'Status', 'Done')
    await user.click(screen.getByRole('tab', { name: 'At risk' }))
    const all = await screen.findByRole('list', { name: 'At-risk projects' })
    expect(within(all).getAllByRole('heading', { level: 3 })).toHaveLength(2) // the reason filter is gone
    expect(screen.getByRole('combobox', { name: 'Reason' })).not.toHaveTextContent(/\w/)
  })
})
