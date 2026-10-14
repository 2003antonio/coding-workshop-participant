import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { reply, seedData, signedInAs } from '../test/fakeApiServer'
import { choose, headersOf, renderApp, rowFor } from '../test/renderApp'

const tabs = () => screen.getAllByRole('tab').map((t) => t.textContent)
const reportCalls = (server, name) => server.calls.filter((c) => c.path === `/api/reports/${name}`)

describe('Reports: which reports each role gets', () => {
  it('admin and manager get all seven', async () => {
    signedInAs('manager')
    renderApp('/reports')
    await screen.findByRole('table', { name: 'Project status' })
    expect(tabs()).toEqual(['Project status', 'At risk', 'Resources', 'Deliverables', 'Near capacity', 'Dependencies', 'Budget'])
  })

  it('an employee gets only the four open to them, even via the URL', async () => {
    const server = signedInAs('employee')
    renderApp('/reports?report=budget')
    await screen.findByRole('table', { name: 'Project status' })
    expect(tabs()).toEqual(['Project status', 'Resources', 'Deliverables', 'Dependencies'])
    expect(screen.getByRole('tab', { name: 'Project status' })).toHaveAttribute('aria-selected', 'true')
    expect(reportCalls(server, 'budget')).toHaveLength(0)
  })
})

describe('Reports: content', () => {
  it('project status shows progress and deliverable counts', async () => {
    signedInAs('admin')
    renderApp('/reports')
    await screen.findByRole('table', { name: 'Project status' })
    expect(headersOf('Project status')).toEqual(['Project', 'Team', 'Status', 'Complete', 'Done', 'Overdue', 'Blocked'])
    const billing = rowFor('Billing v2')
    expect(within(billing).getByText('33%')).toBeInTheDocument()
    expect(within(billing).getByRole('progressbar', { name: 'Billing v2 complete' })).toHaveAttribute('aria-valuenow', '33.33')
    expect(within(billing).getByText('1 of 3')).toBeInTheDocument()
    expect(within(rowFor('Data Lake')).getByText('0%')).toBeInTheDocument()
  })

  it('at risk lists projects with readable reasons', async () => {
    signedInAs('admin')
    const { user } = renderApp('/reports')
    await user.click(await screen.findByRole('tab', { name: 'At risk' }))
    const list = await screen.findByRole('list', { name: 'At-risk projects' })
    expect(within(list).getAllByRole('heading').map((h) => h.textContent)).toEqual(['Billing v2'])
    const reasons = within(list).getByRole('list', { name: 'Why Billing v2 is at risk' })
    expect(within(reasons).getAllByRole('listitem').map((li) => li.textContent))
      .toEqual(['Overdue deliverable', 'Blocked after its start date'])
  })

  it('at risk includes "over budget" for an admin when committed cost passes the planned budget', async () => {
    const db = seedData()
    db.projects.find((p) => p.id === 'p-1').planned_budget = 9000
    signedInAs('admin', { db })
    renderApp('/reports?report=risk')
    const reasons = await screen.findByRole('list', { name: 'Why Billing v2 is at risk' })
    expect(within(reasons).getByText('Over budget')).toBeInTheDocument()
  })

  it('at risk says so when nothing is at risk', async () => {
    signedInAs('admin', { routes: { 'GET /api/reports/at-risk-projects': () => reply(200, { projects: [] }) } })
    renderApp('/reports?report=risk')
    expect(await screen.findByText('No projects are at risk right now.')).toBeInTheDocument()
  })

  it('resources shows a week grid; hours on hidden projects are not named', async () => {
    signedInAs('manager')
    renderApp('/reports?report=resources')
    await screen.findByRole('table', { name: 'Resource allocation' })
    const headers = headersOf('Resource allocation')
    expect(headers.slice(0, 3)).toEqual(['Person', 'Nov 9', 'Nov 16'])
    expect(headers).toHaveLength(13) // person + 12 weeks
    expect(screen.getAllByRole('rowheader').map((r) => r.textContent)).toEqual(['Eve Employee', 'Bo Builder', 'Cy Coder'])
    const eveWeek2 = within(rowFor('Eve Employee')).getAllByRole('cell')[1]
    expect(eveWeek2).toHaveTextContent('36 h')
    expect(eveWeek2.querySelector('span')).toHaveAttribute('title', 'Billing v2: 20 h, Elsewhere: 16 h')
    expect(screen.queryByText(/Data Lake/)).not.toBeInTheDocument()
  })

  it('deliverables can be narrowed to the overdue ones', async () => {
    const server = signedInAs('admin')
    const { user } = renderApp('/reports?report=deliverables')
    await screen.findByRole('table', { name: 'Deliverable status' })
    expect(screen.getAllByRole('rowheader').map((r) => r.textContent)).toEqual(['API spec', 'Frontend', 'Backend', 'Ingest'])
    expect(within(rowFor('Backend')).getByText('1 deliverable')).toBeInTheDocument() // holds up Frontend

    await user.click(screen.getByRole('switch', { name: 'Only overdue' }))
    await waitFor(() => expect(screen.getAllByRole('rowheader').map((r) => r.textContent)).toEqual(['Frontend']))
    expect(reportCalls(server, 'deliverable-status').at(-1).query).toBe('?overdue=true')
  })

  it('near capacity uses 32 hours by default and the threshold can be changed', async () => {
    const server = signedInAs('admin')
    const { user } = renderApp('/reports?report=capacity')
    await screen.findByRole('table', { name: 'Near capacity' })
    expect(reportCalls(server, 'over-allocated')[0].query).toBe('?threshold=32')
    expect(headersOf('Near capacity')).toEqual(['Person', 'Weeks above 32 h'])
    expect(within(rowFor('Eve Employee')).getByText('Nov 16: 36 h')).toBeInTheDocument()
    expect(within(rowFor('Dee Data')).getByText('Nov 9: 36 h, Nov 16: 36 h, Nov 23: 36 h')).toBeInTheDocument()

    const field = screen.getByRole('textbox', { name: 'Threshold (hours per week)' })
    await user.clear(field)
    await user.type(field, '0')
    expect(screen.getByText('Enter whole hours from 1 to 40.')).toBeInTheDocument()
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(reportCalls(server, 'over-allocated').map((c) => c.query)).not.toContain('?threshold=0')

    await user.clear(field)
    await user.type(field, '36')
    expect(await screen.findByText('No one is above 36 hours in any week.')).toBeInTheDocument()
    expect(reportCalls(server, 'over-allocated').at(-1).query).toBe('?threshold=36')
  })

  it('dependencies shows the order to work in and the longest chain for a chosen project', async () => {
    const server = signedInAs('employee')
    const { user } = renderApp('/reports?report=chain')
    expect(await screen.findByText('Choose a project to see its dependency chain.')).toBeInTheDocument()
    await choose(user, 'Project', 'Billing v2')

    expect(await screen.findByText('API spec → Backend → Frontend')).toBeInTheDocument()
    expect(screen.getAllByRole('rowheader').map((r) => r.textContent)).toEqual(['API spec', 'Backend', 'Frontend'])
    expect(within(rowFor('Frontend')).getByText('Backend')).toBeInTheDocument()
    expect(within(rowFor('Frontend')).getByText('3')).toBeInTheDocument()
    expect(reportCalls(server, 'dependency-chain').at(-1).query).toBe('?project_id=p-1')
  })

  it('budget shows planned budget, committed, used to date, percent and the flag', async () => {
    signedInAs('manager')
    renderApp('/reports?report=budget')
    await screen.findByRole('table', { name: 'Project budgets' })
    expect(headersOf('Project budgets'))
      .toEqual(['Project', 'Team', 'Planned budget', 'Committed', 'Used to date', 'Used %', 'Budget', 'Note'])
    const cells = within(rowFor('Billing v2')).getAllByRole('cell').map((c) => c.textContent)
    expect(cells).toEqual(['Platform', '12,000.00', '9,977.73', '3,090.78', '26%', 'Within budget', ''])
    const teams = screen.getByRole('table', { name: 'Team budgets' })
    expect(within(rowFor('Platform', teams)).getByText('246,000.50')).toBeInTheDocument()
  })

  it('budget flags a project whose committed cost is over its planned budget', async () => {
    const db = seedData()
    db.projects.find((p) => p.id === 'p-1').planned_budget = 9000
    signedInAs('admin', { db })
    renderApp('/reports?report=budget')
    await screen.findByRole('table', { name: 'Project budgets' })
    expect(within(rowFor('Billing v2')).getByText('Over budget')).toBeInTheDocument()
    expect(within(rowFor('Billing v2')).getByText('34%')).toBeInTheDocument()
    expect(within(rowFor('Data Lake')).getByText('Not set')).toBeInTheDocument()
    expect(within(rowFor('Data Lake')).getByText('No planned budget')).toBeInTheDocument()
    expect(within(rowFor('Data Lake')).getAllByRole('cell')[4]).toHaveTextContent('—') // no percent without a budget
  })

  it('budget explains hidden totals instead of showing numbers', async () => {
    signedInAs('u-6') // Mia: Data Lake has 2 people, the Data team 1 member
    renderApp('/reports?report=budget')
    await screen.findByRole('table', { name: 'Project budgets' })
    const row = rowFor('Data Lake')
    expect(within(row).getByText(/Totals are hidden because fewer than 3 people/)).toBeInTheDocument()
    expect(within(row).queryByText(/\d\.\d{2}/)).not.toBeInTheDocument()
    expect(within(row).queryByText(/over budget|within budget/i)).not.toBeInTheDocument()
    const teams = screen.getByRole('table', { name: 'Team budgets' })
    expect(within(rowFor('Data', teams)).getByText(/Totals are hidden/)).toBeInTheDocument()
  })

  it('a failing report shows a fixed message and can be retried', async () => {
    let calls = 0
    signedInAs('admin', {
      routes: {
        'GET /api/reports/project-status': () => {
          calls += 1
          return calls === 1 ? reply(400, { error: { code: 'invalid_range', message: 'raw range text' } })
            : reply(200, { projects: [] })
        },
      },
    })
    const { user } = renderApp('/reports')
    expect(await screen.findByText('Choose a date range of at most 52 weeks.')).toBeInTheDocument()
    expect(screen.queryByText(/raw range text/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('No projects to report on.')).toBeInTheDocument()
  })

  it('reports become cards on a phone', async () => {
    signedInAs('admin')
    renderApp('/reports', { width: 400 })
    const list = await screen.findByRole('list', { name: 'Project status' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
  })
})
