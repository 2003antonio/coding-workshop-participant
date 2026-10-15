// Add deliverable: both dates start on today (local time), and a due date
// before the start date is refused with a plain sentence.
/* global process */
import { screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultStartDate } from '../components/deliverableDates'
import { signedInAs } from '../test/fakeApiServer'
import { renderApp } from '../test/renderApp'

const project = { start_date: '2026-11-02', end_date: '2027-03-31' }

describe('Add deliverable: default dates', () => {
  let tz
  beforeEach(() => {
    // New York is behind UTC: at 11:30 pm there it is already tomorrow in UTC,
    // so a date taken from toISOString() would be one day late.
    tz = process.env.TZ
    process.env.TZ = 'America/New_York'
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 30, 23, 30)) // Nov 30, 2026, 11:30 pm local
  })
  afterEach(() => {
    vi.useRealTimers()
    process.env.TZ = tz
  })

  it('starts both dates on today in local time, even late in the evening', async () => {
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-12-01') // the UTC mistake this guards against
    signedInAs('manager')
    const { user } = renderApp('/projects/p-1')
    await user.click(await screen.findByRole('button', { name: 'Add deliverable' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add deliverable' })
    expect(within(dialog).getByLabelText(/start date/i)).toHaveValue('2026-11-30')
    expect(within(dialog).getByLabelText(/due date/i)).toHaveValue('2026-11-30')
  })

  it('refuses a due date before the start date with a plain sentence', async () => {
    const server = signedInAs('manager')
    const { user } = renderApp('/projects/p-1')
    await user.click(await screen.findByRole('button', { name: 'Add deliverable' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add deliverable' })
    await user.type(within(dialog).getByRole('textbox', { name: /^name/i }), 'Launch')
    await user.clear(within(dialog).getByLabelText(/due date/i))
    await user.type(within(dialog).getByLabelText(/due date/i), '2026-11-20')
    await user.click(within(dialog).getByRole('button', { name: 'Add deliverable' }))
    expect(within(dialog).getByText('The due date can’t be before the start date. Pick the start date or a later day.'))
      .toBeInTheDocument()
    expect(server.count('POST', '/api/projects/p-1/deliverables/')).toBe(0)
  })
})

describe('defaultStartDate', () => {
  it('is today inside the project, else the nearest project date', () => {
    expect(defaultStartDate(project, '2026-12-10')).toBe('2026-12-10')
    expect(defaultStartDate(project, '2026-10-14')).toBe('2026-11-02')
    expect(defaultStartDate(project, '2027-05-01')).toBe('2027-03-31')
  })
})
