import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { reply, seedData, signedInAs } from '../test/fakeApiServer'
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
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Deliverables', 'People', 'Budget', 'Dependencies'])

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
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Deliverables', 'People', 'Dependencies'])
    expect(headersOf('Deliverables')).toEqual(['Deliverable', 'Dates', 'Status', 'Depends on'])
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add deliverable|edit project|archive project|dependencies/i }))
      .not.toBeInTheDocument()

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
    // Both dates start filled in (today, moved inside the project), so clear them first.
    await user.clear(within(dialog).getByLabelText(/start date/i))
    await user.type(within(dialog).getByLabelText(/start date/i), '2026-10-01')
    await user.clear(within(dialog).getByLabelText(/due date/i))
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

    expect(await within(dialog).findByText('That would make the dependencies go round in a loop.')).toBeInTheDocument()
    expect(within(dialog).getByText('Loop: API spec -> Frontend -> Backend -> API spec')).toBeInTheDocument()
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
  it('admin sees the weekly cost; assigning over 40 hours names the weeks', async () => {
    const server = signedInAs('admin')
    const { user } = renderApp('/projects/p-1')
    await openTab(user, 'People')
    await screen.findByRole('table', { name: 'Assignments' })
    expect(headersOf('Assignments')).toEqual(['Person', 'Hours per week', 'Dates', 'Weekly cost', 'Actions'])
    // Masked until the admin asks: 20 h × 90,000.50 / 2080.
    expect(within(rowFor('Eve Employee')).queryByText(/865\.39/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show weekly cost for Eve Employee' }))
    expect(within(rowFor('Eve Employee')).getByText('$865.39')).toBeInTheDocument()

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
    expect(within(dialog).getByText('Over 40 hours in: week of Nov 16, 2026 (46 h)')).toBeInTheDocument()
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
  // Billing v2: planned budget 12,000; committed 9,977.73; used to date 3,090.78 (25.8% of the budget).
  it('admin sees the planned budget, costs, percent used, the flag and the cost per assignment', async () => {
    signedInAs('admin')
    const { user } = renderApp('/projects/p-1')
    await openTab(user, 'Budget')
    const panel = await screen.findByRole('region', { name: 'Project budget' })
    const figure = (label) => within(panel).getByText(label, { selector: 'dt' }).nextElementSibling
    expect(figure('Planned budget')).toHaveTextContent('12,000.00')
    expect(figure('Committed cost')).toHaveTextContent('9,977.73')
    expect(figure('Used to date')).toHaveTextContent('3,090.78')
    expect(figure('Percent used')).toHaveTextContent('25.8%')
    expect(within(panel).getByText('Within budget')).toBeInTheDocument()
    expect(headersOf('Cost per assignment'))
      .toEqual(['Person', 'Hours per week', 'Weeks', 'Hourly rate', 'Committed', 'Used to date'])
    expect(within(rowFor('Bo Builder')).queryByText(/40\.00/)).not.toBeInTheDocument() // masked until asked
    await user.click(screen.getByRole('button', { name: 'Show hourly rate for Bo Builder' }))
    expect(within(rowFor('Bo Builder')).getByText('$40.00')).toBeInTheDocument()
  })

  it('the manager sees totals only when at least 3 people are assigned', async () => {
    signedInAs('manager')
    const { user } = renderApp('/projects/p-1')
    await openTab(user, 'Budget')
    const panel = await screen.findByRole('region', { name: 'Project budget' })
    expect(within(panel).getByText('$12,000.00')).toBeInTheDocument()
    expect(within(panel).getByText('$9,977.73')).toBeInTheDocument()
    expect(within(panel).getByText(/3 people assigned/)).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Cost per assignment' })).not.toBeInTheDocument()
  })

  it('without a planned budget it says so, with no percent and no flag either way', async () => {
    signedInAs('admin')
    const { user } = renderApp('/projects/p-2')
    await openTab(user, 'Budget')
    const panel = await screen.findByRole('region', { name: 'Project budget' })
    expect(within(panel).getByText('Planned budget').nextElementSibling).toHaveTextContent('Not set')
    expect(within(panel).queryByText('Percent used')).not.toBeInTheDocument()
    expect(within(panel).getByText('No planned budget')).toBeInTheDocument()
    expect(within(panel).queryByText(/over budget|within budget/i)).not.toBeInTheDocument()
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

  it('below 3 people a typed planned budget still shows, but costs, percent and flag stay hidden', async () => {
    const db = seedData()
    db.projects.find((p) => p.id === 'p-2').planned_budget = 50000
    signedInAs('u-6', { db })
    const { user } = renderApp('/projects/p-2')
    await openTab(user, 'Budget')
    const panel = await screen.findByRole('region', { name: 'Project budget' })
    expect(within(panel).getByText('Planned budget').nextElementSibling).toHaveTextContent('50,000.00')
    expect(within(panel).getByText(/Totals are hidden because fewer than 3 people/)).toBeInTheDocument()
    expect(within(panel).queryByText(/committed|used to date|percent used/i, { selector: 'dt' })).not.toBeInTheDocument()
    expect(within(panel).queryByText(/over budget|within budget/i)).not.toBeInTheDocument()
  })

  it('a planned budget of 0 shows no percent, and any cost is over budget', async () => {
    const db = seedData()
    db.projects.find((p) => p.id === 'p-1').planned_budget = 0
    signedInAs('manager', { db })
    const { user } = renderApp('/projects/p-1')
    await openTab(user, 'Budget')
    const panel = await screen.findByRole('region', { name: 'Project budget' })
    expect(within(panel).getByText('Planned budget', { selector: 'dt' }).nextElementSibling).toHaveTextContent('0.00')
    expect(within(panel).getByText('Percent used', { selector: 'dt' }).nextElementSibling).toHaveTextContent('—')
    expect(within(panel).getByText('Over budget')).toBeInTheDocument()
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

describe('Project detail: edit and planned budget', () => {
  it('the manager lowers the planned budget below the committed cost and the panel flags it', async () => {
    const server = signedInAs('manager')
    const { user } = renderApp('/projects/p-1')
    await openTab(user, 'Budget')
    await screen.findByText('Within budget')

    await user.click(screen.getByRole('button', { name: 'Edit project' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Billing v2' })
    // A manager cannot move the project to another team.
    expect(within(dialog).getByRole('combobox', { name: /team/i })).toHaveAttribute('aria-disabled', 'true')
    const budget = within(dialog).getByRole('textbox', { name: /planned budget/i })
    expect(budget).toHaveValue('12000')
    await user.clear(budget)
    await user.type(budget, '5000.5x')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(within(dialog).getByText('Enter an amount like 52000 or 52000.50.')).toBeInTheDocument()
    expect(server.count('PUT', '/api/projects/p-1')).toBe(0)

    await user.clear(budget)
    await user.type(budget, '5,000.50')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Billing v2 was updated.')).toBeInTheDocument()
    expect(server.calls.find((c) => c.method === 'PUT' && c.path === '/api/projects/p-1').body)
      .toEqual({ planned_budget: 5000.5 })
    const panel = await screen.findByRole('region', { name: 'Project budget' })
    expect(await within(panel).findByText('Over budget')).toBeInTheDocument()
    expect(within(panel).getByText('Planned budget').nextElementSibling).toHaveTextContent('5,000.50')
    expect(within(panel).getByText('Percent used').nextElementSibling).toHaveTextContent('61.8%')
  })

  it('clearing the planned budget sends null; other edits send only what changed', async () => {
    const server = signedInAs('admin')
    const { user } = renderApp('/projects/p-1')
    await user.click(await screen.findByRole('button', { name: 'Edit project' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Billing v2' })
    expect(within(dialog).getByRole('combobox', { name: /team/i })).not.toHaveAttribute('aria-disabled')
    await user.clear(within(dialog).getByRole('textbox', { name: /planned budget/i }))
    await choose(user, /status/i, 'On hold', dialog)
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Billing v2 was updated.')).toBeInTheDocument()
    expect(server.calls.find((c) => c.method === 'PUT').body).toEqual({ status: 'on_hold', planned_budget: null })
    expect(await screen.findByText('On hold')).toBeInTheDocument()
  })

  it('saving with no changes sends nothing', async () => {
    const server = signedInAs('manager')
    const { user } = renderApp('/projects/p-1')
    await user.click(await screen.findByRole('button', { name: 'Edit project' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Billing v2' })
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(server.count('PUT', '/api/projects/p-1')).toBe(0)
  })

  it('a refused edit keeps the dialog open with a fixed message', async () => {
    signedInAs('manager')
    const { user } = renderApp('/projects/p-1')
    await user.click(await screen.findByRole('button', { name: 'Edit project' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Billing v2' })
    await choose(user, /status/i, 'Completed', dialog)
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(await within(dialog).findByText('Finish every deliverable before marking the project completed.'))
      .toBeInTheDocument()
  })

  it('an employee gets no planned budget and no Edit button', async () => {
    signedInAs('employee')
    renderApp('/projects/p-1')
    await screen.findByRole('heading', { name: 'Billing v2' })
    expect(screen.queryByRole('button', { name: 'Edit project' })).not.toBeInTheDocument()
    expect(screen.queryByText(/12,000|planned budget/i)).not.toBeInTheDocument()
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
      project_id: 'p-1', planned_budget: 12000, committed_cost: 9977.73, used_cost_to_date: 3090.78,
      percent_used: 25.76, over_budget: false, allocated_people: 3, hidden_reason: null,
      lines: [{ allocation_id: 'a-1', employee: { id: 'u-3', name: 'Eve Employee' }, hours_per_week: 20, weeks: 7,
        hourly_rate: 43.27, committed_cost: 6057.73, used_cost_to_date: 1730.78 }],
    }),
  }

  it('a hidden group never shows percent used or the over-budget flag, even if they were sent', async () => {
    signedInAs('u-6', {
      routes: {
        'GET /api/projects/p-2/budget': () => reply(200, {
          project_id: 'p-2', planned_budget: 50000, committed_cost: null, used_cost_to_date: null,
          percent_used: 41.5, over_budget: true, allocated_people: 2, hidden_reason: 'below_min_group',
        }),
      },
    })
    const { user } = renderApp('/projects/p-2')
    await openTab(user, 'Budget')
    const panel = await screen.findByRole('region', { name: 'Project budget' })
    expect(within(panel).getByText(/Totals are hidden because fewer than 3 people/)).toBeInTheDocument()
    expect(within(panel).queryByText(/41\.5/)).not.toBeInTheDocument()
    expect(within(panel).queryByText(/percent used/i, { selector: 'dt' })).not.toBeInTheDocument()
    expect(within(panel).queryByText(/over budget|within budget/i)).not.toBeInTheDocument()
  })

  it('the weekly cost column is never shown to a non-admin', async () => {
    signedInAs('manager', { routes: leaky })
    const { user } = renderApp('/projects/p-1')
    await openTab(user, 'People')
    await screen.findByRole('table', { name: 'Assignments' })
    expect(screen.queryByRole('columnheader', { name: /cost|rate|salary/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/865\.39/)).not.toBeInTheDocument()
    expect(screen.queryByText(/43\.27/)).not.toBeInTheDocument()
  })

  it('a manager never sees hourly rates or per-person costs in the budget', async () => {
    signedInAs('manager', { routes: leaky })
    const { user } = renderApp('/projects/p-1')
    await openTab(user, 'Budget')
    const panel = await screen.findByRole('region', { name: 'Project budget' })
    expect(within(panel).getByText('$9,977.73')).toBeInTheDocument() // totals are allowed
    expect(screen.queryByRole('table', { name: 'Cost per assignment' })).not.toBeInTheDocument()
    expect(screen.queryByText(/hourly rate/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/43\.27/)).not.toBeInTheDocument()
    expect(screen.queryByText(/6,057\.73/)).not.toBeInTheDocument()
  })
})

describe('Project detail: one refresh for the whole page', () => {
  it('editing an assignment updates the header budget without a reload', async () => {
    const server = signedInAs('admin')
    const { user } = renderApp('/projects/p-1')
    const summary = await screen.findByRole('region', { name: 'Budget summary' })
    const before = (await within(summary).findByText(/^Committed /)).textContent
    const budgetCalls = server.count('GET', '/api/projects/p-1/budget')

    await user.click(await screen.findByRole('tab', { name: 'People' }))
    await screen.findByRole('table', { name: 'Assignments' })
    await user.click(screen.getByRole('button', { name: 'Edit assignment of Eve Employee' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit assignment of Eve Employee' })
    const hours = within(dialog).getByRole('textbox', { name: /hours per week/i })
    await user.clear(hours)
    await user.type(hours, '10')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(within(summary).getByText(/^Committed /).textContent).not.toBe(before))
    expect(server.count('GET', '/api/projects/p-1/budget')).toBeGreaterThan(budgetCalls)
  })
})

describe('Project detail: health strip', () => {
  it('shows budget, schedule and people tiles to the manager; employees get no budget tile', async () => {
    signedInAs('admin')
    renderApp('/projects/p-1')
    const strip = await screen.findByTestId('health-strip')
    expect(within(strip).getAllByRole('region').map((r) => r.getAttribute('aria-label')))
      .toEqual(expect.arrayContaining(['Budget', 'Budget summary', 'Schedule', 'People']))
    expect(await within(strip).findByRole('list', { name: 'Deliverables by status' })).toBeInTheDocument()
    expect(await within(strip).findByRole('img', { name: /^\d+ (person|people): / })).toBeInTheDocument()
  })

  it('an employee sees schedule and their own hours, never a budget', async () => {
    const server = signedInAs('employee')
    renderApp('/projects/p-1')
    const strip = await screen.findByTestId('health-strip')
    await within(strip).findByText(/^You, \d+ h this week$/)
    expect(within(strip).queryByRole('region', { name: 'Budget' })).not.toBeInTheDocument()
    expect(within(strip).queryByText(/\$/)).not.toBeInTheDocument()
    expect(server.count('GET', '/api/projects/p-1/budget')).toBe(0)
  })
})
