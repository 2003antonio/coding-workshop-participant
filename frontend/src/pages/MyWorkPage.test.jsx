import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { mondayOf, projectsIn, weeksFromAllocations } from '../components/mywork/weekMath'
import { reply, seedData, signedInAs } from '../test/fakeApiServer'
import { renderApp } from '../test/renderApp'

// Fake seed: Eve Employee (u-3) has work, like "Ana" in the real seed; Nia New
// (u-8) has none, like "Hal". Today is 2026-11-10, so the window starts 2026-11-09.
const hoursTable = () => screen.findByRole('table', { name: /^Hours per week, from the week of/ })
const reportCalls = (server) => server.calls.filter((c) => c.path === '/api/reports/resource-allocation')

/** The seed plus an 8 h assignment for `employeeId` on Billing v2. */
function withOwnAllocation(employeeId) {
  const db = seedData()
  db.allocations.push({ id: 'a-9', employee_id: employeeId, project_id: 'p-1', hours_per_week: 8,
    start_date: '2026-11-09', end_date: '2026-11-27', archived_at: null })
  return db
}

describe('My work page', () => {
  it('Eve sees 12 weeks stacked by project, with the year on every label', async () => {
    signedInAs('employee')
    renderApp('/my-work')
    expect(await screen.findByRole('heading', { level: 1, name: 'My work' })).toBeInTheDocument()
    const table = await hoursTable()
    expect(table).toHaveAccessibleName('Hours per week, from the week of Nov 9, 2026')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(12)
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent))
      .toEqual(['Week', 'Billing v2', 'Data Lake', 'Total'])
    expect(rows[0]).toHaveTextContent('week of Nov 9, 202620 h0 h20 h')
    expect(rows[1]).toHaveTextContent('week of Nov 16, 202620 h16 h36 h, near capacity')
    expect(rows[11]).toHaveTextContent('week of Jan 25, 2027')
    // The drawing: one row per week, each label with its year, the 32 h marker on the 36 h week.
    const chart = screen.getByTestId('hours-chart')
    expect(chart).toHaveAttribute('aria-hidden', 'true')
    expect(within(chart).getByText('Nov 9 ’26')).toBeInTheDocument()
    expect(within(chart).getByText('Jan 25 ’27')).toBeInTheDocument()
    expect(within(chart).getAllByText('Over 32 h')).toHaveLength(1)
    expect(screen.getByRole('list', { name: 'Projects in the chart' })).toHaveTextContent('Billing v2Data Lake32 h40 h limit')
  })

  it('lists Eve’s assignments with project, hours per week and dates', async () => {
    signedInAs('employee')
    renderApp('/my-work')
    const table = await screen.findByRole('table', { name: 'Assignments' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.textContent)).toEqual([
      'Billing v220 hNov 2, 2026 – Dec 18, 2026',
      'Data Lake16 hNov 16, 2026 – Nov 20, 2026',
    ])
    expect(within(rows[0]).getByRole('link', { name: 'Billing v2' })).toHaveAttribute('href', '/projects/p-1')
  })

  it('Nia, with no work, sees the empty state', async () => {
    signedInAs('u-8')
    renderApp('/my-work')
    expect(await screen.findByText('Nothing assigned yet.')).toBeInTheDocument()
    expect(await screen.findByText('No hours booked in these weeks.')).toBeInTheDocument()
    expect(screen.queryByTestId('hours-chart')).not.toBeInTheDocument()
  })

  it('pages through the weeks, 12 at a time, and back to this week', async () => {
    const server = signedInAs('employee')
    const { user } = renderApp('/my-work')
    await hoursTable()
    await user.click(screen.getByRole('button', { name: 'Next 12 weeks' }))
    expect(await screen.findByText('12 weeks, from the week of Feb 1, 2027.')).toBeInTheDocument()
    expect(reportCalls(server).at(-1).query).toBe('?from=2027-02-01')
    expect(screen.getByText('No hours booked in these weeks.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'This week' }))
    expect(await screen.findByRole('table', { name: 'Hours per week, from the week of Nov 9, 2026' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Previous 12 weeks' }))
    expect(await screen.findByText('12 weeks, from the week of Aug 17, 2026.')).toBeInTheDocument()
    expect(reportCalls(server).at(-1).query).toBe('?from=2026-08-17')
  })

  it('an admin never sees their hourly rate or weekly cost', async () => {
    const server = signedInAs('admin', { db: withOwnAllocation('u-1') })
    renderApp('/my-work')
    const table = await screen.findByRole('table', { name: 'Assignments' })
    expect(within(table).getByText('8 h')).toBeInTheDocument()
    await hoursTable()
    // The server did send the money fields to the admin...
    const own = await server.calls.find((c) => c.path === '/api/allocations/')
    expect(own.query).toBe('?employee_id=u-1')
    // ...but none of it is on screen.
    const text = document.body.textContent
    expect(text).not.toMatch(/72\.12|576\.92|150,000/)
    expect(text).not.toMatch(/salary|hourly|\brate\b|cost/i)
  })

  it('a manager, outside report 3’s scope, gets their weeks from their own allocations', async () => {
    const server = signedInAs('manager', { db: withOwnAllocation('u-2') })
    renderApp('/my-work')
    const table = await hoursTable()
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(12)
    expect(rows[0]).toHaveTextContent('week of Nov 9, 20268 h8 h')
    expect(rows[3]).toHaveTextContent('week of Nov 30, 20260 h0 h')
    const allocationCalls = server.calls.filter((c) => c.path === '/api/allocations/').map((c) => c.query)
    expect(allocationCalls).toContain('?employee_id=u-2&from=2026-11-09&to=2027-01-25')
  })

  it('a failing hours report leaves the assignments working, and Try again reloads it', async () => {
    let calls = 0
    signedInAs('employee', {
      routes: {
        'GET /api/reports/resource-allocation': () => {
          calls += 1
          return calls === 1
            ? reply(500, { error: { code: 'internal_error', message: 'raw: hours broke' } })
            : reply(200, { weeks: ['2026-11-09'], people: [{ id: 'u-3', name: 'Eve Employee', team_id: 't-1',
              weeks: [{ week_start: '2026-11-09', total_hours: 20, other_hours: 0, projects: [{ id: 'p-1', name: 'Billing v2', hours: 20 }] }] }] })
        },
      },
    })
    const { user } = renderApp('/my-work')
    const hours = await screen.findByRole('region', { name: 'Hours per week' })
    expect(await within(hours).findByText('Something went wrong. Please try again.')).toBeInTheDocument()
    expect(screen.queryByText(/hours broke/)).not.toBeInTheDocument()
    expect(await screen.findByRole('table', { name: 'Assignments' })).toBeInTheDocument()
    await user.click(within(hours).getByRole('button', { name: 'Try again' }))
    expect(await hoursTable()).toHaveTextContent('week of Nov 9, 202620 h20 h')
  })

  it('shows hours from projects the caller cannot see as "Other projects", unnamed', async () => {
    signedInAs('employee', {
      routes: {
        'GET /api/reports/resource-allocation': () => reply(200, { weeks: ['2026-11-09'], people: [{ id: 'u-3', name: 'Eve', team_id: 't-1',
          weeks: [{ week_start: '2026-11-09', total_hours: 30, other_hours: 10, projects: [{ id: 'p-1', name: 'Billing v2', hours: 20 }] }] }] }),
      },
    })
    renderApp('/my-work')
    const table = await hoursTable()
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Week', 'Billing v2', 'Other projects', 'Total'])
    expect(screen.getByRole('list', { name: 'Projects in the chart' })).toHaveTextContent('Other projects')
  })

  it('works at phone width: assignments become cards', async () => {
    signedInAs('employee')
    renderApp('/my-work', { width: 390 })
    expect(await screen.findByRole('heading', { level: 1, name: 'My work' })).toBeInTheDocument()
    expect(await hoursTable()).toBeInTheDocument()
    const cards = await screen.findByRole('list', { name: 'Assignments' })
    expect(within(cards).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Next 12 weeks' })).toBeInTheDocument()
  })
})

describe('My work in the menu and on Home', () => {
  it.each([['admin'], ['manager'], ['employee']])('%s has a "My work" link that opens the page', async (role) => {
    signedInAs(role)
    const { user } = renderApp('/projects')
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    await user.click(within(nav).getByRole('link', { name: 'My work' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'My work' })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'My work' }))
      .toHaveAttribute('aria-current', 'page')
  })

  it('an employee’s Home links to My work instead of repeating the chart', async () => {
    signedInAs('employee')
    renderApp('/')
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome, Eve Employee' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'This week' })).toHaveAttribute('href', '/my-work')
    expect(screen.queryByRole('table', { name: 'Assignments' })).not.toBeInTheDocument()
  })
})

describe('weekMath', () => {
  it('mondayOf finds the Monday, across a year end', () => {
    expect(mondayOf('2026-11-12')).toBe('2026-11-09')
    expect(mondayOf('2026-11-09')).toBe('2026-11-09')
    expect(mondayOf('2027-01-03')).toBe('2026-12-28')
  })

  it('weeksFromAllocations adds up each week, merges a project and skips archived ones', () => {
    const p1 = { id: 'p-1', name: 'Billing v2' }
    const allocations = [
      { project: p1, hours_per_week: 10, start_date: '2026-11-11', end_date: '2026-11-16', archived_at: null },
      { project: p1, hours_per_week: 5, start_date: '2026-11-16', end_date: '2026-11-20', archived_at: null },
      { project: { id: 'p-2', name: 'Data Lake' }, hours_per_week: 30, start_date: '2026-11-09', end_date: '2026-11-30', archived_at: '2026-11-01' },
    ]
    expect(weeksFromAllocations(['2026-11-09', '2026-11-16', '2026-11-23'], allocations)).toEqual([
      { week_start: '2026-11-09', total_hours: 10, other_hours: 0, projects: [{ id: 'p-1', name: 'Billing v2', hours: 10 }] },
      { week_start: '2026-11-16', total_hours: 15, other_hours: 0, projects: [{ id: 'p-1', name: 'Billing v2', hours: 15 }] },
      { week_start: '2026-11-23', total_hours: 0, other_hours: 0, projects: [] },
    ])
  })

  it('projectsIn keeps the order in which projects first appear', () => {
    const weeks = [
      { projects: [{ id: 'b', name: 'B', hours: 1 }] },
      { projects: [{ id: 'a', name: 'A', hours: 1 }, { id: 'b', name: 'B', hours: 2 }] },
    ]
    expect(projectsIn(weeks)).toEqual([{ id: 'b', name: 'B' }, { id: 'a', name: 'A' }])
  })
})
