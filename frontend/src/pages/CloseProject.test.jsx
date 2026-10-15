import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reply, seedData, signedInAs } from '../test/fakeApiServer'
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
    // Closing never archives the project (assignments that had not started yet are removed, by design).
    expect(server.calls.some((c) => c.path === '/api/projects/p-1/archive')).toBe(false)
  })
})

describe('Close project frees people first', () => {
  // The fake server's today is 2026-11-10; the page uses this computer's date.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 10, 9, 0))
  })
  afterEach(() => vi.useRealTimers())

  const withFuture = () => {
    const db = allDone()
    db.allocations.push({ id: 'a-9', employee_id: 'u-5', project_id: 'p-1', hours_per_week: 8,
      start_date: '2026-11-23', end_date: '2026-12-04', archived_at: null })
    return db
  }
  const order = (server) => server.calls.filter((c) => c.method !== 'GET' && !c.path.startsWith('/api/auth'))
    .map((c) => `${c.method} ${c.path} ${JSON.stringify(c.body ?? null)}`)

  it('lists who is still assigned; ends started assignments today, removes future ones, then closes', async () => {
    const server = signedInAs('manager', { db: withFuture() })
    const { user } = await openBilling()
    await user.click(await screen.findByRole('button', { name: 'Close project' }))
    const dialog = await screen.findByRole('dialog', { name: 'Close Billing v2?' })
    expect(within(dialog).getByText('Still assigned: 3 people, 54 h per week.')).toBeInTheDocument()
    expect(within(dialog).getByRole('checkbox', { name: 'End their assignments today so their time is freed' })).toBeChecked()
    await user.click(within(dialog).getByRole('button', { name: 'Close project' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Project closed')
    expect(order(server)).toEqual([
      'PUT /api/allocations/a-1 {"end_date":"2026-11-10"}',
      'PUT /api/allocations/a-2 {"end_date":"2026-11-10"}',
      'PUT /api/allocations/a-3 {"end_date":"2026-11-10"}',
      'POST /api/allocations/a-9/archive null',
      'PUT /api/projects/p-1 {"status":"completed"}',
    ])
  })

  it('a refusal names the person and stops without closing', async () => {
    const server = signedInAs('manager', {
      db: withFuture(),
      routes: { 'PUT /api/allocations/a-2': () => reply(403, { error: { code: 'forbidden', message: 'raw' } }) },
    })
    const { user } = await openBilling()
    await user.click(await screen.findByRole('button', { name: 'Close project' }))
    const dialog = await screen.findByRole('dialog', { name: 'Close Billing v2?' })
    await user.click(within(dialog).getByRole('button', { name: 'Close project' }))
    expect(await within(dialog).findByText(/^Bo Builder's assignment could not be ended: .* The project was not closed\.$/))
      .toBeInTheDocument()
    expect(server.calls.some((c) => c.method === 'PUT' && c.path === '/api/projects/p-1')).toBe(false)
  })

  it('a closed project with people still on it says so on the People tab, with Reopen; its budget shows the final cost', async () => {
    const db = allDone()
    db.projects.find((p) => p.id === 'p-1').status = 'completed'
    signedInAs('admin', { db })
    const { user } = renderApp('/projects/p-1')
    await screen.findByRole('heading', { level: 1, name: 'Billing v2' })
    expect(await screen.findByText(/^Final cost \$[\d,]+\.\d\d of \$12,000\.00 planned, \$[\d,]+\.\d\d (under|over)$/))
      .toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'People' }))
    const notice = await screen.findByText(/This project is closed but 3 people are still assigned \(46 h per\s+week\)\. Reopen it/)
    expect(notice).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /End assignments/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Reopen project' })).toHaveLength(2) // header and notice
  })
})
