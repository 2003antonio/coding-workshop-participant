// Edit and archive actions on the project and team pages: deliverable edit and
// archive, assignment edit, team archive (docs/api-contract.md §3, §5, §6).
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { reply, seedData, signedInAs } from '../test/fakeApiServer'
import { choose, renderApp, rowFor } from '../test/renderApp'
import { ARCHIVE_NOTE } from './apiMessages'

const refuse = (status, code, details) => () => reply(status, { error: { code, message: 'Server text.', details } })
const deliverablesTable = () => screen.findByRole('table', { name: 'Deliverables' })
const openPeople = async (user) => {
  await user.click(await screen.findByRole('tab', { name: 'People' }))
  return screen.findByRole('table', { name: 'Assignments' })
}
async function retype(user, field, text) {
  await user.clear(field)
  await user.type(field, text)
}

describe('Deliverable edit', () => {
  it('the manager changes name and due date; only the changes are sent and the list refreshes', async () => {
    const server = signedInAs('manager')
    const { user } = renderApp('/projects/p-1')
    await deliverablesTable()
    await user.click(screen.getByRole('button', { name: 'Edit Frontend' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Frontend' })
    await retype(user, within(dialog).getByRole('textbox', { name: /^name/i }), 'Web app')
    await retype(user, within(dialog).getByLabelText(/due date/i), '2026-11-20')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Deliverable updated: Web app')).toBeInTheDocument()
    expect(server.calls.find((c) => c.method === 'PUT').body).toEqual({ name: 'Web app', due_date: '2026-11-20' })
    await waitFor(() => expect(within(rowFor('Web app')).getByText('Nov 2, 2026 – Nov 20, 2026')).toBeInTheDocument())
  })

  it('checks the dates on the page before sending', async () => {
    const server = signedInAs('admin')
    const { user } = renderApp('/projects/p-1')
    await deliverablesTable()
    await user.click(screen.getByRole('button', { name: 'Edit Backend' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Backend' })
    await user.clear(within(dialog).getByRole('textbox', { name: /^name/i }))
    await retype(user, within(dialog).getByLabelText(/due date/i), '2026-11-01')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(within(dialog).getByText('Enter a name.')).toBeInTheDocument()
    expect(within(dialog).getByText('Pick a date from Nov 2, 2026 to Mar 31, 2027.')).toBeInTheDocument()
    expect(server.count('PUT', '/api/projects/p-1/deliverables/d-2')).toBe(0)
  })

  it('starting it while a dependency is open is refused and names the open one', async () => {
    signedInAs('manager')
    const { user } = renderApp('/projects/p-1')
    await deliverablesTable()
    await user.click(screen.getByRole('button', { name: 'Edit Frontend' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Frontend' })
    await choose(user, /^status/i, 'In progress', dialog)
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(await within(dialog).findByText('Its dependencies must be done first.')).toBeInTheDocument()
    expect(within(dialog).getByText('Still open: Backend')).toBeInTheDocument()
    expect(screen.queryByText(/Server text/)).not.toBeInTheDocument()
  })

  it.each([
    [400, 'invalid_dates', 'Check the dates: the start must be on or before the end, and inside the project dates.'],
    [409, 'dependents_started', 'Deliverables that depend on this one have already started.'],
    [409, 'archived', "Archived records can't be changed."],
  ])('a %s %s refusal shows its own sentence', async (status, code, sentence) => {
    signedInAs('admin', { routes: { 'PUT /api/projects/p-1/deliverables/d-1': refuse(status, code) } })
    const { user } = renderApp('/projects/p-1')
    await deliverablesTable()
    await user.click(screen.getByRole('button', { name: 'Edit API spec' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit API spec' })
    await user.type(within(dialog).getByRole('textbox', { name: /description/i }), 'v2')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(await within(dialog).findByText(sentence)).toBeInTheDocument()
    expect(screen.queryByText('Server text.')).not.toBeInTheDocument()
  })

  it('saving with no changes sends nothing', async () => {
    const server = signedInAs('admin')
    const { user } = renderApp('/projects/p-1')
    await deliverablesTable()
    await user.click(screen.getByRole('button', { name: 'Edit API spec' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit API spec' })
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(server.count('PUT', '/api/projects/p-1/deliverables/d-1')).toBe(0)
  })
})

describe('Deliverable archive', () => {
  it('asks first; Cancel sends nothing, Archive removes it from the list', async () => {
    const server = signedInAs('manager')
    const { user } = renderApp('/projects/p-1')
    await deliverablesTable()
    await user.click(screen.getByRole('button', { name: 'Archive Frontend' }))
    let dialog = await screen.findByRole('dialog', { name: 'Archive Frontend?' })
    expect(within(dialog).getByText(ARCHIVE_NOTE)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(server.count('POST', '/api/projects/p-1/deliverables/d-3/archive')).toBe(0)

    await user.click(screen.getByRole('button', { name: 'Archive Frontend' }))
    dialog = await screen.findByRole('dialog', { name: 'Archive Frontend?' })
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }))
    expect(await screen.findByText('Deliverable archived: Frontend')).toBeInTheDocument()
    expect(server.count('POST', '/api/projects/p-1/deliverables/d-3/archive')).toBe(1)
    await waitFor(() => expect(screen.queryByRole('rowheader', { name: /Frontend/ })).not.toBeInTheDocument())
  })

  it('one that others depend on is refused with a fixed sentence', async () => {
    signedInAs('admin')
    const { user } = renderApp('/projects/p-1')
    await deliverablesTable()
    await user.click(screen.getByRole('button', { name: 'Archive Backend' }))
    const dialog = await screen.findByRole('dialog', { name: 'Archive Backend?' })
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }))
    expect(await within(dialog).findByText('Other deliverables depend on this one.')).toBeInTheDocument()
    expect(screen.queryByText(/Server text/)).not.toBeInTheDocument()
  })

  it('on a phone the actions sit in each card', async () => {
    signedInAs('admin')
    renderApp('/projects/p-1', { width: 390 })
    const list = await screen.findByRole('list', { name: 'Deliverables' })
    expect(within(list).getByRole('button', { name: 'Edit Frontend' })).toBeInTheDocument()
    expect(within(list).getByRole('button', { name: 'Archive Frontend' })).toBeInTheDocument()
  })
})

describe('Assignment edit', () => {
  it('over 40 hours names the weeks; a smaller change saves and refreshes', async () => {
    const server = signedInAs('admin')
    const { user } = renderApp('/projects/p-1')
    await openPeople(user)
    await user.click(screen.getByRole('button', { name: 'Edit assignment of Eve Employee' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit assignment of Eve Employee' })
    const hours = within(dialog).getByRole('textbox', { name: /hours per week/i })
    expect(hours).toHaveValue('20')

    await retype(user, hours, '0')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(within(dialog).getByText('Enter whole hours from 1 to 40.')).toBeInTheDocument()

    // Eve also has 16 h on Data Lake in the week of Nov 16.
    await retype(user, hours, '30')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(await within(dialog).findByText('This would put the person over 40 hours in some weeks.')).toBeInTheDocument()
    expect(within(dialog).getByText('Over 40 hours in: week of Nov 16, 2026 (46 h)')).toBeInTheDocument()
    expect(within(dialog).queryByText(/Data Lake/)).not.toBeInTheDocument()

    await retype(user, hours, '24')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Assignment updated: Eve Employee')).toBeInTheDocument()
    expect(server.calls.filter((c) => c.method === 'PUT').at(-1).body).toEqual({ hours_per_week: 24 })
    await waitFor(() => expect(within(rowFor('Eve Employee')).getByText('24')).toBeInTheDocument())
  })

  it('the manager changes the dates of someone on their team', async () => {
    const server = signedInAs('manager')
    const { user } = renderApp('/projects/p-1')
    await openPeople(user)
    await user.click(screen.getByRole('button', { name: 'Edit assignment of Bo Builder' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit assignment of Bo Builder' })
    await retype(user, within(dialog).getByLabelText(/end date/i), '2026-12-11')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Assignment updated: Bo Builder')).toBeInTheDocument()
    expect(server.calls.find((c) => c.method === 'PUT').body).toEqual({ end_date: '2026-12-11' })
    await waitFor(() => expect(within(rowFor('Bo Builder')).getByText('Nov 2, 2026 – Dec 11, 2026')).toBeInTheDocument())
  })

  it.each([
    [409, 'overlapping_allocation', 'This person is already assigned to this project for those dates.'],
    [400, 'invalid_dates', 'Check the dates: the start must be on or before the end, and inside the project dates.'],
    [409, 'project_closed', 'This project is archived or completed, so no one can be assigned to it.'],
  ])('a %s %s refusal shows its own sentence', async (status, code, sentence) => {
    signedInAs('admin', { routes: { 'PUT /api/allocations/a-2': refuse(status, code) } })
    const { user } = renderApp('/projects/p-1')
    await openPeople(user)
    await user.click(screen.getByRole('button', { name: 'Edit assignment of Bo Builder' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit assignment of Bo Builder' })
    await retype(user, within(dialog).getByRole('textbox', { name: /hours per week/i }), '12')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(await within(dialog).findByText(sentence)).toBeInTheDocument()
    expect(screen.queryByText('Server text.')).not.toBeInTheDocument()
  })

  it('saving with no changes sends nothing', async () => {
    const server = signedInAs('admin')
    const { user } = renderApp('/projects/p-1')
    await openPeople(user)
    await user.click(screen.getByRole('button', { name: 'Edit assignment of Bo Builder' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit assignment of Bo Builder' })
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(server.count('PUT', '/api/allocations/a-2')).toBe(0)
  })
})

describe('who sees the edit and archive buttons', () => {
  const EDIT_BUTTONS = /^(edit|archive) /i

  it('an employee gets none', async () => {
    signedInAs('employee')
    const { user } = renderApp('/projects/p-1')
    await deliverablesTable()
    expect(screen.queryByRole('button', { name: EDIT_BUTTONS })).not.toBeInTheDocument()
    await openPeople(user)
    expect(screen.queryByRole('button', { name: EDIT_BUTTONS })).not.toBeInTheDocument()
  })

  it('a manager on another team’s project gets none', async () => {
    // Mia leads Data. If she is shown Billing v2 (Platform, managed by Max), she may only read.
    const db = seedData()
    const project = {
      id: 'p-1', team: { id: 't-1', name: 'Platform' }, manager: { id: 'u-2', name: 'Max Manager' },
      name: 'Billing v2', description: '', status: 'active', start_date: '2026-11-02', end_date: '2027-03-31',
      archived_at: null,
    }
    const deliverables = db.deliverables.filter((d) => d.project_id === 'p-1')
      .map((d) => ({ ...d, blocked: false, overdue: false }))
    const allocations = [{
      id: 'a-1', employee: { id: 'u-3', name: 'Eve Employee' }, project: { id: 'p-1', name: 'Billing v2' },
      hours_per_week: 20, start_date: '2026-11-02', end_date: '2026-12-18', archived_at: null,
    }]
    signedInAs('u-6', {
      db,
      routes: {
        'GET /api/projects/p-1': () => reply(200, project),
        'GET /api/projects/p-1/deliverables/': () => reply(200, { deliverables }),
        'GET /api/allocations/': () => reply(200, { allocations }),
      },
    })
    const { user } = renderApp('/projects/p-1')
    await deliverablesTable()
    expect(screen.queryByRole('button', { name: EDIT_BUTTONS })).not.toBeInTheDocument()
    await openPeople(user)
    expect(screen.getByRole('rowheader', { name: 'Eve Employee' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: EDIT_BUTTONS })).not.toBeInTheDocument()
  })
})

describe('Team archive', () => {
  it('the admin archives a team with no open projects, after confirming', async () => {
    const db = seedData()
    db.projects.find((p) => p.id === 'p-2').archived_at = '2026-11-01T09:00:00+00:00'
    const server = signedInAs('admin', { db })
    const { user } = renderApp('/teams/t-2')
    await user.click(await screen.findByRole('button', { name: 'Archive team' }))
    let dialog = await screen.findByRole('dialog', { name: 'Archive Data?' })
    expect(within(dialog).getByText(new RegExp(ARCHIVE_NOTE))).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(server.count('POST', '/api/teams/t-2/archive')).toBe(0)

    await user.click(screen.getByRole('button', { name: 'Archive team' }))
    dialog = await screen.findByRole('dialog', { name: 'Archive Data?' })
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }))
    expect(await screen.findByText('Team archived: Data')).toBeInTheDocument()
    expect(await screen.findByText('This team is archived.')).toBeInTheDocument()
    expect(server.count('POST', '/api/teams/t-2/archive')).toBe(1)
    expect(screen.queryByRole('button', { name: 'Archive team' })).not.toBeInTheDocument()
  })

  it('a team with open projects is refused with a fixed sentence when its projects cannot be listed', async () => {
    signedInAs('admin', { // the team page itself does not list projects; only the look-up after the refusal fails
      routes: { 'GET /api/projects/': () => reply(500, { error: { code: 'x', message: 'Server text' } }) },
    })
    const { user } = renderApp('/teams/t-1')
    await user.click(await screen.findByRole('button', { name: 'Archive team' }))
    const dialog = await screen.findByRole('dialog', { name: 'Archive Platform?' })
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }))
    expect(await within(dialog).findByText("Archive this team's projects first.")).toBeInTheDocument()
    expect(screen.queryByText(/Server text/)).not.toBeInTheDocument()
  })

  it('the team lead and members never see it', async () => {
    signedInAs('manager')
    renderApp('/teams/t-1')
    await screen.findByRole('heading', { name: 'Platform' })
    expect(screen.queryByRole('button', { name: 'Archive team' })).not.toBeInTheDocument()
  })
})

describe('Team archive refused', () => {
  it('names the active projects as links and how many members would leave', async () => {
    const server = signedInAs('admin')
    const { user } = renderApp('/teams/t-2')
    await user.click(await screen.findByRole('button', { name: 'Archive team' }))
    const dialog = await screen.findByRole('dialog', { name: 'Archive Data?' })
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }))
    const alert = await within(dialog).findByText(/can.t be archived while it has 1 active project/)
    expect(alert.closest('[role="alert"]')).toHaveTextContent(
      "Data can't be archived while it has 1 active project: Data Lake. Archive it or move it to another team first. "
      + 'Its 1 member will leave the team when it is archived.')
    expect(within(dialog).getByRole('link', { name: 'Data Lake' })).toHaveAttribute('href', '/projects/p-2')
    expect(server.db.teams.find((t) => t.id === 't-2').archived_at).toBeNull()
  })
})
