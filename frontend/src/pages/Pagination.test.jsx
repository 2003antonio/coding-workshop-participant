import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { reply, seedData, signedInAs } from '../test/fakeApiServer'
import { choose, renderApp } from '../test/renderApp'

/** The seed data plus `n` more employees (on no team), `teams` more teams and `projects` more projects. */
function bigCompany({ people = 0, teams = 0, projects = 0 } = {}) {
  const db = seedData()
  for (let i = 1; i <= people; i += 1) {
    db.employees.push({ id: `x-${i}`, name: `Person ${String(i).padStart(2, '0')}`, role: 'employee',
      job_title: 'Engineer', salary: 80000, team_id: null, email: `p${i}@acme.test`, archived_at: null })
  }
  for (let i = 1; i <= teams; i += 1) {
    db.teams.push({ id: `tx-${i}`, name: `Team ${String(i).padStart(2, '0')}`, lead_id: 'u-2', archived_at: null })
  }
  for (let i = 1; i <= projects; i += 1) {
    db.projects.push({ id: `px-${i}`, team_id: 't-1', name: `Project ${String(i).padStart(2, '0')}`, description: '',
      status: i <= 30 ? 'active' : 'planned', start_date: '2026-11-02', end_date: '2027-03-31', planned_budget: null, archived_at: null })
  }
  return db
}
const bodyRows = (table) => within(table).getAllByRole('row').slice(1)

describe('Long lists come a page at a time', () => {
  it('Employees: 25 a page, the rest on the next', async () => {
    signedInAs('admin', { db: bigCompany({ people: 40 }) }) // 8 + 40 = 48 people
    const { user } = renderApp('/employees')
    const table = await screen.findByRole('table', { name: 'Employees' })
    expect(bodyRows(table)).toHaveLength(25)
    const pages = screen.getByRole('navigation', { name: 'Employees pages' })
    expect(pages).toHaveTextContent('1–25 of 48')

    await user.click(within(pages).getByRole('button', { name: 'Go to next page' }))
    expect(bodyRows(table)).toHaveLength(23)
    expect(pages).toHaveTextContent('26–48 of 48')
  })

  it('Teams: 12 cards a page', async () => {
    signedInAs('admin', { db: bigCompany({ teams: 15 }) }) // 2 + 15 = 17 teams
    const { user } = renderApp('/teams')
    const cards = await screen.findByRole('list', { name: 'Teams' })
    expect(within(cards).getAllByRole('listitem')).toHaveLength(12)
    const pages = screen.getByRole('navigation', { name: 'Teams pages' })
    await user.click(within(pages).getByRole('button', { name: 'Go to next page' }))
    expect(within(screen.getByRole('list', { name: 'Teams' })).getAllByRole('listitem')).toHaveLength(5)
  })

  it('Projects: a filter that shortens the list starts again at the first page', async () => {
    signedInAs('admin', { db: bigCompany({ projects: 40 }) }) // 2 + 40 = 42 projects
    const { user } = renderApp('/projects')
    const table = await screen.findByRole('table', { name: 'Projects' })
    expect(bodyRows(table)).toHaveLength(25)
    const pages = screen.getByRole('navigation', { name: 'Projects pages' })
    await user.click(within(pages).getByRole('button', { name: 'Go to next page' }))
    expect(pages).toHaveTextContent('26–42 of 42')

    await choose(user, 'Status', 'Planned') // 10 of the new ones + Data Lake
    await waitFor(() => expect(bodyRows(screen.getByRole('table', { name: 'Projects' }))).toHaveLength(11))
    expect(screen.queryByRole('navigation', { name: 'Projects pages' })).not.toBeInTheDocument()

    await choose(user, 'Status', 'Active') // 30 of the new ones + Billing v2: back on page 1
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Projects pages' })).toHaveTextContent('1–25 of 31'))
  })

  it('Reports: at-risk cards 10 a page, and the capacity heat-map 25 people a page', async () => {
    const atRisk = Array.from({ length: 12 }, (_, i) => ({
      id: `r-${i}`, name: `Risky ${i}`, team: { id: 't-1', name: 'Platform' }, manager: { id: 'u-2', name: 'Max' },
      reasons: ['overdue_deliverable'],
    }))
    signedInAs('admin', {
      db: bigCompany({ people: 30 }),
      routes: { 'GET /api/reports/at-risk-projects': () => reply(200, { projects: atRisk }) },
    })
    const { user } = renderApp('/reports?tab=at-risk')
    const cards = await screen.findByRole('list', { name: 'At-risk projects' })
    expect(within(cards).getAllByRole('heading')).toHaveLength(10)
    expect(screen.getByRole('navigation', { name: 'At-risk projects pages' })).toHaveTextContent('1–10 of 12')

    await user.click(screen.getByRole('tab', { name: /resource/i }))
    const heat = await screen.findByRole('table', { name: 'Resource allocation' })
    expect(within(heat).getAllByRole('rowheader')).toHaveLength(25)
    expect(screen.getByRole('navigation', { name: 'People pages' })).toHaveTextContent('1–25 of')
  })
})

describe('Home dashboard lists show the top few, with a link to the rest', () => {
  const project = (i, fields) => ({
    id: `p-${i}`, name: `Project ${i}`, team: { id: 't-1', name: 'Platform' }, manager: { id: 'u-2', name: 'Max' },
    planned_budget: 1000, committed_cost: 500, used_cost_to_date: 100, percent_used: 10, over_budget: false,
    hidden_reason: null, reasons: ['overdue_deliverable'], ...fields,
  })

  it('at-risk: the 6 with the most reasons; budgets: over and close first; "View all" opens the report', async () => {
    const risky = Array.from({ length: 9 }, (_, i) => project(i, i === 7
      ? { reasons: ['past_end_date', 'overdue_deliverable', 'unstaffed'] } : {}))
    const budgets = Array.from({ length: 8 }, (_, i) => project(i, i === 5
      ? { committed_cost: 1200, over_budget: true } : {}))
    signedInAs('admin', {
      routes: {
        'GET /api/reports/at-risk-projects': () => reply(200, { projects: risky }),
        'GET /api/reports/budget': () => reply(200, { projects: budgets, teams: [] }),
      },
    })
    const { user } = renderApp('/')
    const riskList = await screen.findByRole('list', { name: 'At-risk projects' })
    const riskItems = within(riskList).getAllByRole('heading')
    expect(riskItems).toHaveLength(6)
    expect(riskItems[0]).toHaveTextContent('Project 7')
    const bars = await screen.findByRole('list', { name: 'Budget used by project' })
    expect(within(bars).getAllByRole('listitem')).toHaveLength(6)
    expect(within(bars).getAllByRole('listitem')[0]).toHaveTextContent('Project 5')
    expect(screen.getByRole('link', { name: 'View all 8 project budgets' })).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'View all 9 at-risk projects' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Reports' })).toBeInTheDocument()
    const all = await screen.findByRole('list', { name: 'At-risk projects' })
    expect(within(all).getAllByRole('heading')).toHaveLength(9) // fits on one page of 10
  })

  it('no link when everything already shows', async () => {
    signedInAs('admin')
    renderApp('/')
    await screen.findByRole('list', { name: 'Budget used by project' })
    expect(screen.queryByRole('link', { name: /^View all \d+ (at-risk projects|project budgets)$/ })).not.toBeInTheDocument()
  })
})
