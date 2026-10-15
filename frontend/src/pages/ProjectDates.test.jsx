import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { signedInAs } from '../test/fakeApiServer'
import { renderApp } from '../test/renderApp'
import { datesConflicts } from '../components/projectDates'

async function editDates(user, { start, end }) {
  await user.click(await screen.findByRole('button', { name: 'Edit project' }))
  const dialog = await screen.findByRole('dialog', { name: 'Edit Billing v2' })
  if (start) fireEvent.change(within(dialog).getByLabelText(/Start date/), { target: { value: start } })
  if (end) fireEvent.change(within(dialog).getByLabelText(/End date/), { target: { value: end } })
  return dialog
}

describe('Edit project dates: checked before saving', () => {
  it('a later start date that would leave work outside is refused, naming up to three', async () => {
    const server = signedInAs('manager')
    const { user } = renderApp('/projects/p-1')
    await screen.findByRole('table', { name: 'Deliverables' })
    const dialog = await editDates(user, { start: '2026-11-10' })
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(await within(dialog).findByText('API spec starts Nov 2, 2026, before the new start date. '
      + 'Backend starts Nov 9, 2026, before the new start date. '
      + 'Frontend starts Nov 2, 2026, before the new start date. And 3 more.')).toBeInTheDocument()
    expect(server.calls.some((c) => c.method === 'PUT' && c.path === '/api/projects/p-1')).toBe(false)
  })

  it('names deliverables due and assignments ending after a new end date; unchanged dates are not checked', () => {
    const deliverables = [{ name: 'Launch', start_date: '2026-11-02', due_date: '2026-12-11' }]
    const allocations = [{ employee: { name: 'Bo Chen' }, start_date: '2026-11-02', end_date: '2026-12-18' }]
    expect(datesConflicts('2026-11-02', '2026-12-01', deliverables, allocations)).toEqual({
      start: null,
      end: 'Launch is due Dec 11, 2026, after the new end date. '
        + "Bo Chen's assignment ends Dec 18, 2026, after the new end date.",
    })
    expect(datesConflicts('2026-11-02', '2027-01-01', deliverables, [{ ...allocations[0], archived_at: 'x' }]))
      .toEqual({ start: null, end: null })
  })
})
