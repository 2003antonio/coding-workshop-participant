import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { seedData, signedInAs } from '../test/fakeApiServer'
import { renderApp } from '../test/renderApp'

/** Seed data where Billing v2 (p-1) has the given deliverables. */
function withDeliverables(change) {
  const db = seedData()
  db.deliverables = db.deliverables.map((d) => (d.project_id === 'p-1' ? change(d) : d)).filter(Boolean)
  return db
}
const allDone = () => withDeliverables((d) => ({ ...d, status: 'done', completed_at: '2026-11-06T16:00:00+00:00' }))

async function openBilling() {
  const view = renderApp('/projects/p-1')
  await screen.findByRole('heading', { level: 1, name: 'Billing v2' })
  await screen.findByRole('table', { name: 'Deliverables' })
  return view
}

describe('Close project', () => {
  it('is hidden while a deliverable is open', async () => {
    signedInAs('manager')
    await openBilling()
    expect(await screen.findByRole('button', { name: 'Edit project' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close project' })).not.toBeInTheDocument()
  })

  it('is hidden when the project has no deliverables', async () => {
    signedInAs('manager', { db: withDeliverables(() => null) })
    renderApp('/projects/p-1')
    await screen.findByText('No deliverables yet.')
    expect(screen.queryByRole('button', { name: 'Close project' })).not.toBeInTheDocument()
  })

  it('is hidden for an employee even when every deliverable is done', async () => {
    signedInAs('employee', { db: allDone() })
    await openBilling()
    expect(screen.queryByRole('button', { name: 'Close project' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reopen project' })).not.toBeInTheDocument()
  })

  it('the manager closes the project when all is done, then reopens it; nothing is archived', async () => {
    const server = signedInAs('manager', { db: allDone() })
    const { user } = await openBilling()

    await user.click(await screen.findByRole('button', { name: 'Close project' }))
    const dialog = await screen.findByRole('dialog', { name: 'Close Billing v2?' })
    expect(dialog).toHaveAccessibleDescription('It stays visible and can be reopened. Closing does not archive it.')
    await user.click(within(dialog).getByRole('button', { name: 'Close project' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Project closed')
    const puts = () => server.calls.filter((c) => c.method === 'PUT' && c.path === '/api/projects/p-1')
    expect(puts().map((c) => c.body)).toEqual([{ status: 'completed' }])
    expect(await screen.findByRole('button', { name: 'Reopen project' })).toBeInTheDocument()
    expect(screen.getAllByText('Completed').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Close project' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reopen project' }))
    await waitFor(() => expect(puts().map((c) => c.body)).toEqual([{ status: 'completed' }, { status: 'active' }]))
    expect(await screen.findByText('Project reopened')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Close project' })).toBeInTheDocument()
    expect(server.calls.some((c) => c.path.endsWith('/archive'))).toBe(false)
  })
})
