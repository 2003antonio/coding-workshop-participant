// Changing hours, a deliverable's name or its due date in place on the project page.
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { reply, signedInAs } from '../test/fakeApiServer'
import { renderApp, rowFor } from '../test/renderApp'

const CHANGE = /, change /

async function openPeople(user) {
  await user.click(await screen.findByRole('tab', { name: 'People' }))
  return screen.findByRole('table', { name: 'Assignments' })
}

describe('In-place editing: hours per week', () => {
  it('the manager types new hours and Enter saves them', async () => {
    const server = signedInAs('manager')
    const { user } = renderApp('/projects/p-1')
    await openPeople(user)
    await user.click(screen.getByRole('button', { name: '10, change hours per week of Bo Builder' }))
    const hours = screen.getByRole('textbox', { name: 'Change hours per week of Bo Builder' })
    await user.clear(hours)
    await user.type(hours, '14{Enter}')
    expect(await screen.findByText('Assignment updated: Bo Builder')).toBeInTheDocument()
    expect(server.calls.find((c) => c.method === 'PUT').body).toEqual({ hours_per_week: 14 })
    await waitFor(() => expect(within(rowFor('Bo Builder')).getByRole('button', { name: CHANGE })).toHaveTextContent('14'))
  })

  it('over 40 hours is refused: the old hours come back and the weeks are named', async () => {
    signedInAs('admin')
    const { user } = renderApp('/projects/p-1')
    await openPeople(user)
    await user.click(screen.getByRole('button', { name: '20, change hours per week of Eve Employee' }))
    const hours = screen.getByRole('textbox', { name: 'Change hours per week of Eve Employee' })
    await user.clear(hours)
    await user.type(hours, '30{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Eve Employee: This would put the person over 40 hours in some weeks. '
      + 'Over 40 hours in: week of Nov 16, 2026 (46 h). The change was undone.')
    expect(screen.getByRole('button', { name: '20, change hours per week of Eve Employee' })).toBeInTheDocument()
    expect(screen.queryByText(/Server text|Data Lake/)).not.toBeInTheDocument()
  })

  it('hours outside 1 to 40 are caught before sending', async () => {
    const server = signedInAs('admin')
    const { user } = renderApp('/projects/p-1')
    await openPeople(user)
    await user.click(screen.getByRole('button', { name: '20, change hours per week of Eve Employee' }))
    const hours = screen.getByRole('textbox', { name: 'Change hours per week of Eve Employee' })
    await user.clear(hours)
    await user.type(hours, '41{Enter}')
    expect(screen.getByText('Enter whole hours from 1 to 40.')).toBeInTheDocument()
    expect(server.count('PUT', '/api/allocations/a-1')).toBe(0)
  })
})

describe('In-place editing: deliverables', () => {
  it('rename with Enter; Escape cancels without sending', async () => {
    const server = signedInAs('manager')
    const { user } = renderApp('/projects/p-1')
    await screen.findByRole('table', { name: 'Deliverables' })

    await user.click(screen.getByRole('button', { name: 'Backend, change name of Backend' }))
    await user.type(screen.getByRole('textbox', { name: 'Change name of Backend' }), ' v2{Escape}')
    expect(server.count('PUT', '/api/projects/p-1/deliverables/d-2')).toBe(0)
    expect(screen.getByRole('button', { name: 'Backend, change name of Backend' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Backend, change name of Backend' }))
    await user.type(screen.getByRole('textbox', { name: 'Change name of Backend' }), ' v2{Enter}')
    expect(await screen.findByText('Deliverable updated: Backend v2')).toBeInTheDocument()
    expect(server.calls.find((c) => c.method === 'PUT').body).toEqual({ name: 'Backend v2' })
  })

  it('a new due date saves when leaving the field', async () => {
    const server = signedInAs('admin')
    const { user } = renderApp('/projects/p-1')
    await screen.findByRole('table', { name: 'Deliverables' })
    await user.click(screen.getByRole('button', { name: 'Nov 9, 2026 – Dec 4, 2026, change due date of Backend' }))
    const due = screen.getByLabelText('Change due date of Backend')
    await user.clear(due)
    await user.type(due, '2026-12-11')
    await user.tab()
    expect(await screen.findByText('Deliverable updated: Backend')).toBeInTheDocument()
    expect(server.calls.find((c) => c.method === 'PUT').body).toEqual({ due_date: '2026-12-11' })
    await waitFor(() => expect(within(rowFor('Backend')).getByText('Nov 9, 2026 – Dec 11, 2026')).toBeInTheDocument())
  })

  it('a due date before the start is caught before sending', async () => {
    const server = signedInAs('admin')
    const { user } = renderApp('/projects/p-1')
    await screen.findByRole('table', { name: 'Deliverables' })
    await user.click(screen.getByRole('button', { name: /change due date of Backend/ }))
    const due = screen.getByLabelText('Change due date of Backend')
    await user.clear(due)
    await user.type(due, '2026-11-05{Enter}')
    expect(screen.getByText('The due date can’t be before the start date. Pick the start date or a later day.')).toBeInTheDocument()
    await user.clear(due)
    await user.type(due, '2027-06-01{Enter}')
    expect(screen.getByText('Pick a date from Nov 2, 2026 to Mar 31, 2027.')).toBeInTheDocument()
    await user.clear(due)
    await user.keyboard('{Enter}')
    expect(screen.getByText('Choose a due date.')).toBeInTheDocument()
    expect(server.count('PUT', '/api/projects/p-1/deliverables/d-2')).toBe(0)
  })

  it('an empty name is caught before sending', async () => {
    signedInAs('admin')
    const { user } = renderApp('/projects/p-1')
    await screen.findByRole('table', { name: 'Deliverables' })
    await user.click(screen.getByRole('button', { name: 'Backend, change name of Backend' }))
    await user.clear(screen.getByRole('textbox', { name: 'Change name of Backend' }))
    await user.keyboard('{Enter}')
    expect(screen.getByText('Enter a name.')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Change name of Backend' }), `${'x'.repeat(201)}{Enter}`)
    expect(screen.getByText('Use at most 200 characters.')).toBeInTheDocument()
  })

  it('a refused rename rolls back and says why', async () => {
    signedInAs('admin', {
      routes: { 'PUT /api/projects/p-1/deliverables/d-2': () => reply(409, { error: { code: 'archived', message: 'Server text.' } }),
      },
    })
    const { user } = renderApp('/projects/p-1')
    await screen.findByRole('table', { name: 'Deliverables' })
    await user.click(screen.getByRole('button', { name: 'Backend, change name of Backend' }))
    await user.type(screen.getByRole('textbox', { name: 'Change name of Backend' }), ' v2{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Backend: Archived records can't be changed. The change was undone.")
    expect(screen.getByRole('button', { name: 'Backend, change name of Backend' })).toBeInTheDocument()
  })
})

describe('who can edit in place', () => {
  it('an employee gets plain text, no buttons to change values', async () => {
    signedInAs('employee')
    const { user } = renderApp('/projects/p-1')
    await screen.findByRole('table', { name: 'Deliverables' })
    expect(rowFor('Backend')).toHaveTextContent('Nov 9, 2026 – Dec 4, 2026')
    expect(screen.queryByRole('button', { name: CHANGE })).not.toBeInTheDocument()
    await openPeople(user)
    expect(within(rowFor('Eve Employee')).getByText('20')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: CHANGE })).not.toBeInTheDocument()
  })
})
