import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { barScale, budgetState, overBudgetCount, portfolioHealth } from '../components/dashboard/dashboardMath'
import { greeting, localToday, nextDeadline, overdueOrSoon, workloadSummary } from '../components/home/homeMath'
import { reply, signedInAs } from '../test/fakeApiServer'
import { renderApp } from '../test/renderApp'

const region = (name) => screen.getByRole('region', { name })
/** Wait for a number card to finish loading, then return its big number. */
async function cardValue(name) {
  const card = await screen.findByRole('region', { name })
  await waitFor(() => expect(within(card).queryByRole('status')).not.toBeInTheDocument())
  return within(card).getAllByRole('paragraph')[0].textContent
}
/** Width of a budget bar part, and where the 100% marker sits, in percent of the track. */
const widthOf = (item, part) => parseFloat(getComputedStyle(item.querySelector(`[data-part="${part}"]`)).width)
const leftOf = (item) => parseFloat(getComputedStyle(item.querySelector('[data-part="plan"]')).left)
const MONEY = /\d{1,3}(,\d{3})+\.\d{2}|\d+\.\d{2}\b(?!%)/ // "9,978.00", "43.27": any amount of money

describe('Home: admin company dashboard', () => {
  it('keeps the welcome heading and shows the number cards', async () => {
    signedInAs('admin')
    renderApp('/')
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome, Ada Admin' })).toBeInTheDocument()
    expect(screen.getByText('Company overview: every team and project.')).toBeInTheDocument()
    expect(await cardValue('Active projects')).toBe('1')
    expect(await cardValue('At risk')).toBe('1')
    expect(await cardValue('Overdue deliverables')).toBe('1')
    expect(await cardValue('Over budget')).toBe('0') // admin: a real 0
    expect(await cardValue('Near capacity')).toBe('2') // Eve 36 h and Dee 36 h, above 32
  })

  it('lists at-risk projects with a link, the team and readable reason chips', async () => {
    signedInAs('admin')
    renderApp('/')
    const list = await within(await screen.findByRole('region', { name: 'At-risk projects' }))
      .findByRole('list', { name: 'At-risk projects' })
    expect(within(list).getByRole('link', { name: 'Billing v2' })).toHaveAttribute('href', '/projects/p-1')
    expect(within(list).getByText('Platform')).toBeInTheDocument()
    const chips = within(list).getByRole('list', { name: 'Why Billing v2 is at risk' })
    expect(within(chips).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Overdue deliverable', 'Blocked'])
    expect(within(chips).getAllByTestId(/Icon$/)).toHaveLength(2) // each chip has its icon
  })

  it('shows committed against planned and spent so far, and "No budget set" without a plan', async () => {
    signedInAs('admin')
    renderApp('/')
    const bars = await within(await screen.findByRole('region', { name: 'Budget used' }))
      .findByRole('list', { name: 'Budget used by project' })
    const [billing, lake] = within(bars).getAllByRole('listitem')
    // Billing v2: committed 9,977.73 of 12,000 (83%), spent 25.8% so far.
    expect(within(billing).getByText('Committed $9,978 of $12,000 planned (83%)')).toBeInTheDocument()
    expect(within(billing).getByText('Spent so far: 26%')).toBeInTheDocument()
    expect(within(billing).getByText('Close to budget')).toBeInTheDocument()
    expect(within(billing).queryByText('Over budget')).not.toBeInTheDocument()
    expect(widthOf(billing, 'committed')).toBeLessThan(leftOf(billing)) // 83%: before the marker
    expect(widthOf(billing, 'spent')).toBeLessThan(widthOf(billing, 'committed'))
    expect(lake).toHaveTextContent('Data LakeNo budget set')
    expect(lake.querySelector('[data-kind]')).not.toBeInTheDocument()
    expect(lake).not.toHaveTextContent(/\$|%/)
  })

  it('an over-budget project gets the chip, a bar past the 100% marker, and both measures in words', async () => {
    const team = { id: 't-1', name: 'Platform' }
    const project = (id, name, fields) => ({
      id, name, team, planned_budget: 1000, committed_cost: 500, used_cost_to_date: 400,
      percent_used: 40, over_budget: false, hidden_reason: null, ...fields,
    })
    signedInAs('admin', {
      routes: {
        'GET /api/reports/budget': () => reply(200, {
          projects: [
            project('p-a', 'Over one', { planned_budget: 38000, committed_cost: 41180, percent_used: 27, over_budget: true }),
            project('p-b', 'Close one', { committed_cost: 850 }),
            project('p-c', 'Fine one', {}),
          ],
          teams: [],
        }),
      },
    })
    renderApp('/')
    const bars = await screen.findByRole('list', { name: 'Budget used by project' })
    const [over, close, fine] = within(bars).getAllByRole('listitem')
    expect(within(over).getByText('Committed $41,180 of $38,000 planned (108%)')).toBeInTheDocument()
    expect(within(over).getByText('Spent so far: 27%')).toBeInTheDocument()
    expect(within(over).getByText('Over budget')).toBeInTheDocument()
    expect(widthOf(over, 'committed')).toBeGreaterThan(leftOf(over)) // 108% passes the marker
    expect(widthOf(over, 'spent')).toBeLessThan(widthOf(over, 'committed'))
    expect(within(close).getByText('Committed $850 of $1,000 planned (85%)')).toBeInTheDocument()
    expect(within(close).getByText('Close to budget')).toBeInTheDocument()
    expect(within(close).queryByText('Over budget')).not.toBeInTheDocument()
    expect(widthOf(close, 'committed')).toBeLessThan(leftOf(close))
    expect(within(fine).queryByText(/budget$/)).not.toBeInTheDocument() // no chip
    expect(fine).toHaveTextContent('Committed $500 of $1,000 planned (50%)')
    expect(await cardValue('Over budget')).toBe('1')
  })

  it('never shows a salary, rate or per-person cost; money only in "Committed ... planned" lines', async () => {
    signedInAs('admin')
    renderApp('/')
    await screen.findByRole('list', { name: 'Budget used by project' })
    await screen.findByRole('list', { name: 'At-risk projects' })
    await cardValue('Near capacity')
    const text = document.body.textContent
    expect(text).not.toMatch(MONEY)
    expect(text).not.toMatch(/salary|hourly|\brate\b|weekly cost/i)
    expect(text).not.toMatch(/90,000|43\.27|6,058|2,800/) // Eve's salary and rate, per-person costs
    const withDollars = [...document.querySelectorAll('p')].filter((el) => el.textContent.includes('$'))
    expect(withDollars.length).toBeGreaterThan(0)
    for (const el of withDollars) expect(el.textContent).toMatch(/^Committed \$[\d,]+ of \$[\d,]+ planned/)
  })
})

describe('Home: manager team dashboard', () => {
  it('shows the cards for the teams they lead', async () => {
    signedInAs('manager') // Max leads Platform: 3 people on Billing v2, so real numbers
    renderApp('/')
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome, Max Manager' })).toBeInTheDocument()
    expect(screen.getByText('Overview of the teams you lead.')).toBeInTheDocument()
    expect(await cardValue('Active projects')).toBe('1')
    expect(await cardValue('Over budget')).toBe('0')
    expect(await cardValue('Near capacity')).toBe('1') // only Eve is on Platform
  })

  it('a hidden budget says hidden, never 0', async () => {
    signedInAs('u-6') // Mia leads Data: 2 people on Data Lake, so the server hides its costs
    renderApp('/')
    expect(await cardValue('Over budget')).toBe('Hidden')
    const budgetCard = region('Over budget')
    expect(budgetCard).toHaveTextContent('Fewer than 3 people on these projects')
    const bars = await screen.findByRole('list', { name: 'Budget used by project' })
    expect(within(bars).getByRole('listitem')).toHaveTextContent('Data LakeHidden: fewer than 3 people')
    expect(within(bars).queryByText(/%/)).not.toBeInTheDocument()
    expect(within(budgetCard).queryByText('0')).not.toBeInTheDocument()
    expect(await screen.findByText('No projects are at risk right now.')).toBeInTheDocument()
  })

  it('one failing report leaves the other cards working, and Try again reloads it', async () => {
    let budgetCalls = 0
    signedInAs('manager', {
      routes: {
        'GET /api/reports/budget': () => {
          budgetCalls += 1
          return budgetCalls === 1
            ? reply(500, { error: { code: 'internal_error', message: 'raw: budget exploded' } })
            : reply(200, { projects: [], teams: [] })
        },
      },
    })
    const { user } = renderApp('/')
    const budgetCard = await screen.findByRole('region', { name: 'Over budget' })
    expect(await within(budgetCard).findByText('Something went wrong. Please try again.')).toBeInTheDocument()
    expect(within(region('Budget used')).getByText('Something went wrong. Please try again.')).toBeInTheDocument()
    expect(screen.queryByText(/budget exploded/)).not.toBeInTheDocument()
    // The rest of the page still works.
    expect(await cardValue('Active projects')).toBe('1')
    expect(await cardValue('Near capacity')).toBe('1')
    expect(await screen.findByRole('list', { name: 'At-risk projects' })).toBeInTheDocument()

    await user.click(within(budgetCard).getByRole('button', { name: 'Try again' }))
    expect(await cardValue('Over budget')).toBe('0')
    expect(budgetCalls).toBe(2)
  })

  it('works at phone width', async () => {
    signedInAs('manager')
    renderApp('/', { width: 390 })
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome, Max Manager' })).toBeInTheDocument()
    expect(await cardValue('At risk')).toBe('1')
    expect(await screen.findByRole('list', { name: 'At-risk projects' })).toBeInTheDocument()
    expect(await screen.findByRole('list', { name: 'Budget used by project' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Menu' })).toBeInTheDocument()
  })
})

describe('Home: card links', () => {
  it('every number card is one link to the page with the detail, and at-risk rows say "View project"', async () => {
    signedInAs('admin')
    renderApp('/')
    const linkIn = async (name) => {
      await cardValue(name)
      return within(region(name)).getByRole('link', { name })
    }
    expect(await linkIn('Active projects')).toHaveAttribute('href', '/projects?status=active')
    expect(await linkIn('At risk')).toHaveAttribute('href', '/reports?tab=at-risk')
    expect(await linkIn('Overdue deliverables')).toHaveAttribute('href', '/reports?tab=deliverables')
    expect(await linkIn('Over budget')).toHaveAttribute('href', '/reports?tab=budget')
    expect(await linkIn('Near capacity')).toHaveAttribute('href', '/reports?tab=near-capacity')
    const list = await screen.findByRole('list', { name: 'At-risk projects' })
    expect(within(list).getByRole('link', { name: 'View project Billing v2' })).toHaveAttribute('href', '/projects/p-1')
  })

  it('a manager card opens Reports on the right tab', async () => {
    signedInAs('manager')
    const { user } = renderApp('/')
    await cardValue('Near capacity')
    await user.click(within(region('Near capacity')).getByRole('link', { name: 'Near capacity' }))
    expect(await screen.findByRole('tab', { name: 'Near capacity', selected: true })).toBeInTheDocument()
  })

  it('"Active projects" opens Projects with the Active filter already chosen', async () => {
    signedInAs('admin')
    const { user } = renderApp('/')
    await cardValue('Active projects')
    await user.click(within(region('Active projects')).getByRole('link', { name: 'Active projects' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveTextContent('Active')
  })
})

describe('query params from the Home cards', () => {
  it('unknown or not-allowed values fall back to the defaults', async () => {
    signedInAs('employee')
    const { unmount } = renderApp('/reports?tab=budget') // an employee has no Budget report
    expect(await screen.findByRole('tab', { name: 'Project status', selected: true })).toBeInTheDocument()
    unmount()
    renderApp('/reports?tab=nonsense')
    expect(await screen.findByRole('tab', { name: 'Project status', selected: true })).toBeInTheDocument()
  })

  it('Projects ignores an unknown ?status=', async () => {
    const server = signedInAs('admin')
    renderApp('/projects?status=toString')
    expect(await screen.findByRole('link', { name: 'Billing v2' })).toBeInTheDocument()
    const lists = server.calls.filter((c) => c.method === 'GET' && c.path === '/api/projects/')
    expect(lists.length).toBeGreaterThan(0)
    lists.forEach((c) => expect(new URLSearchParams(c.query).has('status')).toBe(false))
  })
})

describe('Home: employee', () => {
  // The fake server's today is Tuesday 2026-11-10; Home reads the computer's date for "due soon".
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 10, 9, 0))
  })
  afterEach(() => vi.useRealTimers())

  it('greets by time of day and shows four tiles that lead to My work or a project', async () => {
    const server = signedInAs('employee')
    renderApp('/')
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome, Eve Employee' })).toBeInTheDocument()
    expect(screen.getByText('Good morning. Here is your week.')).toBeInTheDocument()
    const week = await screen.findByRole('region', { name: 'This week' })
    expect(within(week).getByRole('img', { name: '20 of 40 hours booked this week' })).toBeInTheDocument()
    expect(within(week).getByText('20 of 40 h')).toBeInTheDocument()
    expect(within(week).getByRole('link', { name: 'This week' })).toHaveAttribute('href', '/my-work')
    expect(within(region('Projects')).getByText('2')).toBeInTheDocument()
    const deadline = region('Next deadline')
    expect(within(deadline).getByText('Backend')).toBeInTheDocument()
    expect(within(deadline).getByText('Due in 24 days')).toBeInTheDocument()
    expect(within(deadline).getByRole('link', { name: 'Next deadline' })).toHaveAttribute('href', '/projects/p-1')
    expect(within(region('Overdue')).getByText('1')).toBeInTheDocument()
    expect(within(region('Overdue')).getByText('deliverable needs attention')).toBeInTheDocument()
    // Not the My work page again, and no manager reports.
    expect(screen.queryByRole('table', { name: 'Assignments' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'At a glance' })).not.toBeInTheDocument()
    expect(server.count('GET', '/api/reports/at-risk-projects')).toBe(0)
    expect(server.count('GET', '/api/reports/budget')).toBe(0)
  })

  it('shows my projects as cards, what is coming up, who I work with and the next 12 weeks; no pay data', async () => {
    signedInAs('employee')
    renderApp('/')
    const mine = await screen.findByRole('list', { name: 'My projects' })
    const billing = within(mine).getByRole('link', { name: 'Billing v2' }).closest('li')
    expect(within(billing).getByRole('link', { name: 'Billing v2' })).toHaveAttribute('href', '/projects/p-1')
    expect(within(billing).getByText('Platform')).toBeInTheDocument()
    expect(within(billing).getByText('1 of 3 done, 1 overdue.')).toBeInTheDocument()
    expect(within(mine).getByRole('link', { name: 'Data Lake' })).toHaveAttribute('href', '/projects/p-2')

    const coming = region('Coming up')
    expect(within(coming).getByRole('link', { name: 'Frontend' })).toHaveAttribute('href', '/projects/p-1')
    expect(within(coming).getByText('1 day overdue')).toBeInTheDocument()

    const people = region('Who you work with')
    const stack = within(people).getByRole('img')
    expect(stack).toHaveAccessibleName(/people: /)
    expect(stack).not.toHaveAccessibleName(/Eve Employee/)

    const strip = region('Next 12 weeks')
    expect(within(strip).getByRole('list', { name: 'Your hours per week, next 12 weeks' })).toHaveTextContent('Nov 9 ’26: 20 h')
    expect(within(strip).getByRole('link', { name: 'See full breakdown' })).toHaveAttribute('href', '/my-work')
    expect(document.body.textContent).not.toMatch(/\$|salary|hourly rate/i)
  })

  it('says when nothing is coming up', async () => {
    signedInAs('employee', {
      routes: { 'GET /api/reports/deliverable-status': () => reply(200, { deliverables: [] }) },
    })
    renderApp('/')
    expect(await within(await screen.findByRole('region', { name: 'Coming up' })).findByText('Nothing due soon.')).toBeInTheDocument()
    expect(within(region('Next deadline')).getByText('Nothing due on your projects.')).toBeInTheDocument()
    expect(within(region('Overdue')).getByText('Nothing overdue')).toBeInTheDocument()
  })

  it('someone with no assignments still gets the greeting and zero tiles, then an empty state', async () => {
    signedInAs('u-8') // Nia New: no team, no allocations
    renderApp('/')
    expect(await screen.findByText('You are not assigned to any project yet')).toBeInTheDocument()
    expect(screen.getByText('Good morning. Here is your week.')).toBeInTheDocument()
    expect(within(region('This week')).getByText('0 of 40 h')).toBeInTheDocument()
    expect(within(region('Projects')).getByText('0')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open My work' })).toHaveAttribute('href', '/my-work')
    expect(screen.queryByRole('region', { name: 'Coming up' })).not.toBeInTheDocument()
  })
})

describe('homeMath', () => {
  const p1 = { id: 'p-1', name: 'Billing v2' }
  const alloc = (hours, start, end, project = p1) => ({ project, hours_per_week: hours, start_date: start, end_date: end, archived_at: null })

  it('localToday uses the local calendar day, not UTC', () => {
    expect(localToday(new Date(2026, 9, 14, 23, 30))).toBe('2026-10-14')
    expect(localToday(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01')
  })

  it('workloadSummary: steady, then free; free now, busy later; nothing booked', () => {
    expect(workloadSummary([alloc(20, '2026-11-02', '2026-12-11')], '2026-11-10'))
      .toBe('20 h per week through the week of Dec 7 ’26, then free.')
    expect(workloadSummary([alloc(10, '2026-12-01', '2026-12-31')], '2026-11-10'))
      .toBe('Free this week. 10 h per week from the week of Nov 30 ’26.')
    expect(workloadSummary([alloc(8, '2026-01-01', '2027-12-31')], '2026-11-10'))
      .toBe('8 h per week for the next 26 weeks.')
    expect(workloadSummary([], '2026-11-10')).toBeNull()
  })

  it('nextDeadline and overdueOrSoon skip done work and sort by due date', () => {
    const d = (id, due, status = 'not_started', overdue = false) => ({ id, due_date: due, status, overdue })
    const list = [d('late', '2026-11-01', 'in_progress', true), d('soon', '2026-11-15'), d('later', '2026-12-20'), d('done', '2026-11-11', 'done')]
    expect(nextDeadline(list, '2026-11-10').id).toBe('soon')
    expect(overdueOrSoon(list, '2026-11-10').map((x) => x.id)).toEqual(['late', 'soon'])
    expect(nextDeadline([], '2026-11-10')).toBeNull()
  })
})

describe('dashboard rules', () => {
  const row = (fields) => ({ id: 'p', name: 'P', planned_budget: 1000, committed_cost: 500, percent_used: 10, over_budget: false, hidden_reason: null, ...fields })

  it('budgetState: hidden, no budget, over, close and fine, committed and spent kept apart', () => {
    expect(budgetState(row({ hidden_reason: 'below_min_group', committed_cost: null, percent_used: null, over_budget: null })))
      .toEqual({ kind: 'hidden', text: 'Hidden: fewer than 3 people' })
    expect(budgetState(row({ planned_budget: null, percent_used: null, over_budget: null })))
      .toEqual({ kind: 'none', text: 'No budget set' })
    expect(budgetState(row({ planned_budget: 38000, committed_cost: 41180, percent_used: 27, over_budget: true }))).toEqual({
      kind: 'over', committedPct: (41180 / 38000) * 100, spentPct: 27,
      committed: 'Committed $41,180 of $38,000 planned (108%)', spent: 'Spent so far: 27%',
    })
    expect(budgetState(row({ committed_cost: 800 })).kind).toBe('close')
    expect(budgetState(row({ committed_cost: 799 })).kind).toBe('ok')
    // over_budget decides "over", even when spent so far is low.
    expect(budgetState(row({ committed_cost: 1200, percent_used: 5, over_budget: true })).kind).toBe('over')
    // A 0 budget: no percentage to show, but the amounts are still said.
    const zero = budgetState(row({ planned_budget: 0, committed_cost: 300, percent_used: null, over_budget: true }))
    expect(zero).toMatchObject({ kind: 'over', committedPct: null, spentPct: null, committed: 'Committed $300 of $0 planned', spent: null })
  })

  it('barScale always shows the 100% marker and stops at 200%', () => {
    expect(barScale({ committedPct: 50, spentPct: 20 })).toBe(110)
    expect(barScale({ committedPct: 108, spentPct: 27 })).toBe(118)
    expect(barScale({ committedPct: 500, spentPct: 10 })).toBe(200)
    expect(barScale({ committedPct: null, spentPct: null })).toBe(110)
  })

  it('overBudgetCount counts only shown projects and never turns hidden into 0', () => {
    expect(overBudgetCount({ projects: [] })).toEqual({ value: 0, note: 'Committed cost above the plan' })
    expect(overBudgetCount({ projects: [row({ over_budget: true }), row({ id: 'q' })] }).value).toBe(1)
    expect(overBudgetCount({ projects: [row({ hidden_reason: 'below_min_group' })] }).value).toBe('Hidden')
    expect(overBudgetCount({ projects: [row({ over_budget: true }), row({ id: 'q', hidden_reason: 'below_min_group' })] }))
      .toEqual({ value: 1, note: '1 more hidden: fewer than 3 people' })
  })
})

describe('Home: portfolio health and the employee sparkline', () => {
  it('admin sees one bar of healthy / at risk / over budget, said in words', async () => {
    signedInAs('admin')
    renderApp('/')
    const health = await screen.findByRole('region', { name: 'Portfolio health' })
    const legend = await within(health).findByRole('list', { name: 'Projects by health' })
    expect(within(legend).getByText('At risk')).toBeInTheDocument()
    expect(within(health).getByText(/^\d+ of \d+ projects? healthy\.$/)).toBeInTheDocument()
  })

  it('counts each project once; hidden budgets are never counted as over', () => {
    const ids = (...list) => list.map((id) => ({ id }))
    expect(portfolioHealth(
      { projects: ids('a', 'b', 'c', 'd') },
      { projects: ids('b', 'c') },
      { projects: [{ id: 'c', over_budget: true }, { id: 'd', over_budget: null, hidden_reason: 'below_min_group' }] },
    )).toEqual({ healthy: 2, at_risk: 1, over_budget: 1, hidden: 1 })
  })

  it('greeting follows the hour on this computer', () => {
    expect(greeting(new Date(2026, 10, 10, 7))).toBe('Good morning')
    expect(greeting(new Date(2026, 10, 10, 13))).toBe('Good afternoon')
    expect(greeting(new Date(2026, 10, 10, 20))).toBe('Good evening')
  })
})

describe('Home: Coming up (admin and manager)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 10, 23, 30)) // late evening: still Nov 10 on this computer
  })
  afterEach(() => vi.useRealTimers())

  const item = (id, due, extra = {}) => ({
    id, name: `D ${id}`, project: { id: 'p-1', name: 'Billing v2' }, status: 'in_progress', start_date: '2026-11-02',
    due_date: due, overdue: due < '2026-11-10', blocked: false, blocking: [], ...extra,
  })

  it('lists overdue and next-14-days deliverables, soonest first, at most six, each linking to its project', async () => {
    signedInAs('manager', {
      routes: {
        'GET /api/reports/deliverable-status': () => reply(200, { deliverables: [
          item('late', '2026-11-03'), item('soon', '2026-11-12'), item('edge', '2026-11-24'), item('far', '2026-11-25'),
          item('done', '2026-11-11', { status: 'done' }), item('a', '2026-11-13'), item('b', '2026-11-14'),
          item('c', '2026-11-15'), item('d', '2026-11-16'),
        ] }),
      },
    })
    renderApp('/')
    const card = await screen.findByRole('region', { name: 'Coming up' })
    const links = await within(card).findAllByRole('link', { name: /^D / })
    expect(links.map((l) => l.textContent)).toEqual(['D late', 'D soon', 'D a', 'D b', 'D c', 'D d'])
    expect(links[0]).toHaveAttribute('href', '/projects/p-1')
    expect(within(card).getByText('7 days overdue')).toBeInTheDocument()
    expect(within(card).getByText('Due in 2 days')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'View all deliverables' }))
      .toHaveAttribute('href', '/reports?tab=deliverables')
  })

  it('says when nothing is due in the next 14 days', async () => {
    signedInAs('admin', {
      routes: { 'GET /api/reports/deliverable-status': () => reply(200, { deliverables: [item('far', '2026-12-01')] }) },
    })
    renderApp('/')
    const card = await screen.findByRole('region', { name: 'Coming up' })
    expect(await within(card).findByText('Nothing due in the next 14 days.')).toBeInTheDocument()
  })
})
