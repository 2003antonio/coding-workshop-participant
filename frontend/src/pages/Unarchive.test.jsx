import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { seedData, signedInAs } from '../test/fakeApiServer'
import { renderApp, rowFor } from '../test/renderApp'

const ARCHIVED_AT = '2026-07-01T09:00:00+00:00'

describe('Employees: unarchive (admin)', () => {
  it('"Show archived" lists archived people greyed out with Unarchive; Unarchive restores them', async () => {
    const db = seedData()
    db.employees.find((e) => e.id === 'u-8').archived_at = ARCHIVED_AT // Nia New
    const server = signedInAs('admin', { db })
    const { user } = renderApp('/employees')
    await screen.findByRole('table', { name: 'Employees' })
    expect(screen.queryByText('Nia New')).not.toBeInTheDocument()

    await user.click(screen.getByRole('switch', { name: 'Show archived' }))
    const row = await waitFor(() => rowFor('Nia New'))
    expect(row).toHaveAttribute('data-muted', 'true')
    expect(within(row).getByText('Archived')).toBeInTheDocument()
    expect(rowFor('Eve Employee')).not.toHaveAttribute('data-muted')

    await user.click(within(row).getByRole('button', { name: 'Unarchive Nia New' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Employee unarchived: Nia New')
    expect(server.count('POST', '/api/employees/u-8/unarchive')).toBe(1)
    await waitFor(() => expect(rowFor('Nia New')).not.toHaveAttribute('data-muted'))
    expect(within(rowFor('Nia New')).getByRole('button', { name: 'Archive Nia New' })).toBeInTheDocument()
  })
})

describe('Projects: unarchive (admin and the team’s manager)', () => {
  it('the team’s manager sees the archived project muted and unarchives it', async () => {
    const server = signedInAs('manager') // Max leads Platform, the team of the archived "Old Portal"
    const { user } = renderApp('/projects')
    await screen.findByRole('table', { name: 'Projects' })
    await user.click(screen.getByRole('switch', { name: 'Show archived' }))
    const row = await waitFor(() => rowFor('Old Portal'))
    expect(row).toHaveAttribute('data-muted', 'true')

    await user.click(within(row).getByRole('button', { name: 'Unarchive Old Portal' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Project unarchived: Old Portal')
    expect(server.count('POST', '/api/projects/p-3/unarchive')).toBe(1)
    await waitFor(() => expect(within(rowFor('Old Portal')).getByRole('button', { name: 'Archive Old Portal' }))
      .toBeInTheDocument())
  })

  it('a refusal (team archived) says why in a sentence, with no toast', async () => {
    const db = seedData()
    db.teams.find((t) => t.id === 't-1').archived_at = ARCHIVED_AT
    signedInAs('admin', { db })
    const { user } = renderApp('/projects')
    await screen.findByRole('table', { name: 'Projects' })
    await user.click(screen.getByRole('switch', { name: 'Show archived' }))
    await user.click(await screen.findByRole('button', { name: 'Unarchive Old Portal' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Old Portal: Its team is archived, so this project cannot be restored.')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('an employee never sees Show archived or Unarchive', async () => {
    signedInAs('employee')
    renderApp('/projects')
    await screen.findByRole('table', { name: 'Projects' })
    expect(screen.queryByRole('switch', { name: 'Show archived' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Unarchive/ })).not.toBeInTheDocument()
  })
})
