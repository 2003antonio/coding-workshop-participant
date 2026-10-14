import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { reply, signedInAs } from '../test/fakeApiServer'
import { choose, headersOf, renderApp, rowFor } from '../test/renderApp'

const deliverablesTable = () => screen.findByRole('table', { name: 'Deliverables' })
const openTab = async (user, name) => user.click(await screen.findByRole('tab', { name }))

describe('Project detail: header and tabs', () => {
  it('shows the project with team, manager and dates; the manager can archive it', async () => {
    const server = signedInAs('manager')
    const { user } = renderApp('/projects/p-1')
    expect(await screen.findByRole('heading', { name: 'Billing v2' })).toBeInTheDocument()
    expect(screen.getByText(/Platform · Manager: Max Manager · Nov 2, 2026 – Mar 31, 2027/)).toBeInTheDocument()
    expect(screen.getByText('New invoices')).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Deliverables', 'People', 'Budget'])

    await user.click(screen.getByRole('button', { name: 'Archive project' }))
    const dialog = await screen.findByRole('dialog', { name: 'Archive Billing v2?' })
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }))
    expect(await screen.findByText('Billing v2 was archived.')).toBeInTheDocument()
    expect(server.count('POST', '/api/projects/p-1/archive')).toBe(1)
    expect(await screen.findByText('Archived')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive project' })).not.toBeInTheDocument()
  })

  it('employee reads deliverables and own assignments, with no budget and no edit controls', async () => {
    const server = signedInAs('employee')
    const { user } = renderApp('/projects/p-1')
    await deliverablesTable()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Deliverables', 'People'])
    expect(headersOf('Deliverables')).toEqual(['Deliverable', 'Dates', 'Status', 'Depends on'])
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add deliverable|archive project|dependencies/i })).not.toBeInTheDocument()

    await openTab(user, 'People')
    await screen.findByRole('table', { name: 'Assignments' })
    expect(screen.getByText('You can see only your own assignments.')).toBeInTheDocument()
    expect(headersOf('Assignments')).toEqual(['Person', 'Hours per week', 'Dates'])
    expect(screen.getAllByRole('rowheader').map((r) => r.textContent)).toEqual(['Eve Employee'])
    expect(server.count('GET', '/api/projects/p-1/budget')).toBe(0)
  })

  it('a project the caller cannot see shows a not-found message', async () => {
    signedInAs('manager')
    renderApp('/projects/p-2')
    expect(await screen.findByText("That item doesn't exist or you can't see it.")).toBeInTheDocument()
  })
})

describe('Project detail: deliverables', () => {
  it('lists dates, dependencies and overdue / blocked flags', async () => {
    signedInAs('admin')
    renderApp('/projects/p-1')
    await deliverablesTable()
    const frontend = rowFor('Frontend')
    expect(within(frontend).getByText('Nov 2, 2026 – Nov 9, 2026')).toBeInTheDocument()
    expect(within(frontend).getByText('Backend')).toBeInTheDocument() // depends on
    expect(within(frontend).getByText('Overdue')).toBeInTheDocument()
    expect(within(frontend).getByText('Blocked')).toBeInTheDocument()
    expect(within(rowFor('API spec')).queryByText(/Overdue|Blocked/)).not.toBeInTheDocument()
  })

  it('starting a deliverable whose dependencies are open shows which ones, from the details', async () => {
    const server = signedInAs('manager')
    const { user } = renderApp('/projects/p-1')
    await deliverablesTable()
    await choose(user, 'Status of Frontend', 'In progress')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Frontend: Its dependencies must be done first. Still open: Backend.')
    expect(screen.queryByText(/Server text/)).not.toBeInTheDocument()
    expect(server.calls.find((c) => c.method === 'PUT').body).toEqual({ status: 'in_progress' })
  })

  it('finishing a deliverable saves the status and unblocks its dependents', async () => {
    signedInAs('manager')
    const { user } = renderApp('/projects/p-1')
    await deliverablesTable()
    await choose(user, 'Status of Backend', 'Done')
    expect(await screen.findByText('Backend is now done.')).toBeInTheDocument()
    await waitFor(() => expect(within(rowFor('Frontend')).queryByText('Blocked')).not.toBeInTheDocument())
  })

  it('adds a deliverable with dates inside the project and dependencies', async () => {
    const server = signedInAs('manager')
    const { user } = renderApp('/projects/p-1')
    await deliverablesTable()
    await user.click(screen.getByRole('button', { name: 'Add deliverable' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add deliverable' })

    await user.type(within(dialog).getByRole('textbox', { name: /^name/i }), 'Launch')
    await user.type(within(dialog).getByLabelText(/start date/i), '2026-10-01')
    await user.type(within(dialog).getByLabelText(/due date/i), '2027-01-15')
    await user.click(within(dialog).getByRole('button', { name: 'Add deliverable' }))
    expect(within(dialog).getByText('Pick a date from Nov 2, 2026 to Mar 31, 2027.')).toBeInTheDocument()
    expect(server.count('POST', '/api/projects/p-1/deliverables/')).toBe(0)

    await user.clear(within(dialog).getByLabelText(/start date/i))
    await user.type(within(dialog).getByLabelText(/start date/i), '2027-01-04')
    await user.click(within(dialog).getByRole('checkbox', { name: /Frontend/ }))
    await user.click(within(dialog).getByRole('checkbox', { name: /Backend/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Add deliverable' }))

    expect(await screen.findByText('Launch was added.')).toBeInTheDocument()
    expect(server.calls.find((c) => c.method === 'POST' && c.path === '/api/projects/p-1/deliverables/').body).toEqual({
      name: 'Launch', description: '', start_date: '2027-01-04', due_date: '2027-01-15', depends_on: ['d-3', 'd-2'],
    })
    await waitFor(() => expect(within(rowFor('Launch')).getByText('Frontend, Backend')).toBeInTheDocument())
  })

  it('a dependency loop is refused and the loop is named', async () => {
    const server = signedInAs('admin')
    const { user } = renderApp('/projects/p-1')
    await deliverablesTable()
    await user.click(screen.getByRole('button', { name: 'Edit dependencies of API spec' }))
    const dialog = await screen.findByRole('dialog', { name: 'Dependencies of API spec' })
    expect(within(dialog).queryByRole('checkbox', { name: /API spec/ })).not.toBeInTheDocument() // not itself
    await user.click(within(dialog).getByRole('checkbox', { name: /Frontend/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Save dependencies' }))

    expect(await within(dialog).findByText(
      'That would make the dependencies go round in a loop. Loop: API spec → Frontend → Backend → API spec.',
    )).toBeInTheDocument()
    expect(server.calls.at(-1).body).toEqual({ depends_on: ['d-3'] })
  })

  it('saves a new set of dependencies', async () => {
    signedInAs('admin')
    const { user } = renderApp('/projects/p-1')
    await deliverablesTable()
    await user.click(screen.getByRole('button', { name: 'Edit dependencies of Frontend' }))
    const dialog = await screen.findByRole('dialog', { name: 'Dependencies of Frontend' })
    expect(within(dialog).getByRole('checkbox', { name: /Backend/ })).toBeChecked()
    await user.click(within(dialog).getByRole('checkbox', { name: /Backend/ }))
    await user.click(within(dialog).getByRole('checkbox', { name: /API spec/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Save dependencies' }))
    expect(await screen.findByText('Dependencies of Frontend were saved.')).toBeInTheDocument()
    await waitFor(() => expect(within(rowFor('Frontend')).queryByText('Blocked')).not.toBeInTheDocument())
  })

  it('a project with no deliverables says so', async () => {
    signedInAs('admin', { routes: { 'GET /api/projects/p-1/deliverables/': () => reply(200, { deliverables: [] }) } })
    renderApp('/projects/p-1')
    expect(await screen.findByText('No deliverables yet.')).toBeInTheDocument()
  })
})

describe('Project detail: people', () => {
  it('admin sees the weekly cost; assigning over 40 hours lists the weeks', async () => {
    const server = signedInAs('admin')
    const { user } = renderApp('/projects/p-1')
    await openTab(user, 'People')
    await screen.findByRole('table', { name: 'Assignments' })
    expect(headersOf('Assignments')).toEqual(['Person', 'Hours per week', 'Dates', 'Weekly cost', 'Actions'])
    expect(within(rowFor('Eve Employee')).getByText('865.39')).toBeInTheDocument() // 20 h × 90,000.50 / 2080

    await user.click(screen.getByRole('button', { name: 'Assign person' }))
    const dialog = await screen.findByRole('dialog', { name: 'Assign someone to Billing v2' })
    await choose(user, /person/i, /Eve Employee/, dialog)
    await user.type(within(dialog).getByRole('textbox', { name: /hours per week/i }), '41')
    await user.click(within(dialog).getByRole('button', { name: 'Assign' }))
    expect(within(dialog).getByText('Enter whole hours from 1 to 40.')).toBeInTheDocument()

    await user.clear(within(dialog).getByRole('textbox', { name: /hours per week/i }))
    await user.type(within(dialog).getByRole('textbox', { name: /hours per week/i }), '10')
    await user.click(within(dialog).getByRole('button', { name: 'Assign' }))

    // Eve already has 20 h here and 16 h on Data Lake in the week of Nov 16.
    expect(await within(dialog).findByText('This would put the person over 40 hours in some weeks.')).toBeInTheDocument()
    const weeks = within(dialog).getByRole('list', { name: 'Weeks over 40 hours' })
    expect(within(weeks).getAllByRole('listitem').map((li) => li.textContent))
      .toEqual(['Week of Nov 16, 2026: 46 hours'])
    expect(within(dialog).queryByText(/Data Lake/)).not.toBeInTheDocument()
    expect(server.calls.at(-1).body).toEqual({
      employee_id: 'u-3', project_id: 'p-1', hours_per_week: 10, start_date: '2026-11-02', end_date: '2027-03-31',
    })
  })

  it('manager can assign only members of the project’s team, and remove people', async () => {
    const server = signedInAs('manager')
    const { user } = renderApp('/projects/p-1')
    await openTab(user, 'People')
    await screen.findByRole('table', { name: 'Assignments' })
    expect(headersOf('Assignments')).toEqual(['Person', 'Hours per week', 'Dates', 'Actions'])
    expect(server.count('GET', '/api/employees/')).toBe(0)

    await user.click(screen.getByRole('button', { name: 'Assign person' }))
    const dialog = await screen.findByRole('dialog', { name: 'Assign someone to Billing v2' })
    await user.click(within(dialog).getByRole('combobox', { name: /person/i }))
    expect(screen.getAllByRole('option').map((o) => o.textContent))
      .toEqual(['Eve Employee (Engineer)', 'Bo Builder (Engineer)', 'Cy Coder (Designer)'])
    await user.click(screen.getByRole('option', { name: /Cy Coder/ }))
    await user.type(within(dialog).getByRole('textbox', { name: /hours per week/i }), '8')
    await user.clear(within(dialog).getByLabelText(/end date/i))
    await user.type(within(dialog).getByLabelText(/end date/i), '2026-12-18')
    await user.click(within(dialog).getByRole('button', { name: 'Assign' }))
    expect(await screen.findByText('Cy Coder was assigned.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove Bo Builder' }))
    const confirm = await screen.findByRole('dialog', { name: 'Remove Bo Builder from Billing v2?' })
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('Bo Builder was removed from this project.')).toBeInTheDocument()
    expect(server.count('POST', '/api/allocations/a-2/archive')).toBe(1)
    await waitFor(() => expect(screen.queryByRole('rowheader', { name: 'Bo Builder' })).not.toBeInTheDocument())
  })

  it('a completed project cannot get new assignments', async () => {
    signedInAs('admin', {
      routes: {
        'GET /api/projects/p-1': () => reply(200, {
          id: 'p-1', team: { id: 't-1', name: 'Platform' }, manager: { id: 'u-2', name: 'Max Manager' },
          name: 'Billing v2', description: '', status: 'completed', start_date: '2026-11-02',
          end_date: '2027-03-31', archived_at: null,
        }),
      },
    })
    const { user } = renderApp('/projects/p-1')
    await openTab(user, 'People')
    await screen.findByRole('table', { name: 'Assignments' })
    expect(screen.queryByRole('button', { name: /assign person|remove/i })).not.toBeInTheDocument()
  })
})

describe('Project detail: budget', () => {
  it('admin sees totals and the cost per assignment with hourly rates', async () => {
    signedInAs('admin')
    const { user } = renderApp('/projects/p-1')
    await openTab(user, 'Budget')
    const panel = await screen.findByRole('region', { name: 'Project budget' })
    expect(within(panel).getByText('9,977.73')).toBeInTheDocument() // planned
    expect(within(panel).getByText('3,090.78')).toBeInTheDocument() // used up to this week
    expect(within(panel).getByText('6,886.95')).toBeInTheDocument() // remaining
    expect(headersOf('Cost per assignment'))
      .toEqual(['Person', 'Hours per week', 'Weeks', 'Hourly rate', 'Planned', 'Used'])
    expect(within(rowFor('Bo Builder')).getByText('40.00')).toBeInTheDocument()
  })

  it('the manager sees totals only when at least 3 people are assigned', async () => {
    signedInAs('manager')
    const { user } = renderApp('/projects/p-1')
    await openTab(user, 'Budget')
    const panel = await screen.findByRole('region', { name: 'Project budget' })
    expect(within(panel).getByText('9,977.73')).toBeInTheDocument()
    expect(within(panel).getByText(/3 people assigned/)).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Cost per assignment' })).not.toBeInTheDocument()
  })

  it('below 3 people the manager sees why the totals are hidden, and no number', async () => {
    signedInAs('u-6') // Mia manages Data Lake, which has 2 people assigned
    const { user } = renderApp('/projects/p-2')
    await openTab(user, 'Budget')
    const panel = await screen.findByRole('region', { name: 'Project budget' })
    expect(within(panel).getByText(
      'Totals are hidden because fewer than 3 people are in this group, so they could reveal someone’s pay.',
    )).toBeInTheDocument()
    expect(within(panel).queryByText(/\d+\.\d{2}/)).not.toBeInTheDocument()
    expect(within(panel).getByText(/2 people assigned/)).toBeInTheDocument()
  })

  it('a budget error shows a fixed message', async () => {
    signedInAs('manager', {
      routes: { 'GET /api/projects/p-1/budget': () => reply(500, { error: { code: 'x', message: 'raw salary 90000' } }) },
    })
    const { user } = renderApp('/projects/p-1')
    await openTab(user, 'Budget')
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument()
    expect(screen.queryByText(/90000/)).not.toBeInTheDocument()
  })
})

// If a response for a non-admin ever carried pay data, the page must still not show it.
describe('salary data never reaches a non-admin screen', () => {
  const leaky = {
    'GET /api/allocations/': () => reply(200, {
      allocations: [{
        id: 'a-1', employee: { id: 'u-3', name: 'Eve Employee' }, project: { id: 'p-1', name: 'Billing v2' },
        hours_per_week: 20, start_date: '2026-11-02', end_date: '2026-12-18', archived_at: null,
        hourly_rate: 43.27, weekly_cost: 865.39,
      }],
    }),
    'GET /api/projects/p-1/budget': () => reply(200, {
      project_id: 'p-1', planned: 9977.73, used: 3090.78, remaining: 6886.95, allocated_people: 3, hidden_reason: null,
      lines: [{ allocation_id: 'a-1', employee: { id: 'u-3', name: 'Eve Employee' }, hours_per_week: 20, weeks: 7,
        hourly_rate: 43.27, planned: 6057.73, used: 1730.78 }],
    }),
  }

  it('the weekly cost column is never shown to a non-admin', async () => {
    signedInAs('manager', { routes: leaky })
    const { user } = renderApp('/projects/p-1')
    await openTab(user, 'People')
    await screen.findByRole('table', { name: 'Assignments' })
    expect(screen.queryByRole('columnheader', { name: /cost|rate|salary/i })).not.toBeInTheDocument()
    expect(screen.queryByText('865.39')).not.toBeInTheDocument()
    expect(screen.queryByText('43.27')).not.toBeInTheDocument()
  })

  it('a manager never sees hourly rates or per-person costs in the budget', async () => {
    signedInAs('manager', { routes: leaky })
    const { user } = renderApp('/projects/p-1')
    await openTab(user, 'Budget')
    const panel = await screen.findByRole('region', { name: 'Project budget' })
    expect(within(panel).getByText('9,977.73')).toBeInTheDocument() // totals are allowed
    expect(screen.queryByRole('table', { name: 'Cost per assignment' })).not.toBeInTheDocument()
    expect(screen.queryByText(/hourly rate/i)).not.toBeInTheDocument()
    expect(screen.queryByText('43.27')).not.toBeInTheDocument()
    expect(screen.queryByText('6,057.73')).not.toBeInTheDocument()
  })
})
