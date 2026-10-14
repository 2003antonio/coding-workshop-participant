// Project page header (budget bar) and the Dependencies tab (report 6 as a timeline).
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reply, seedData, signedInAs } from '../test/fakeApiServer'
import { renderApp } from '../test/renderApp'

const CHAIN_PATH = 'GET /api/reports/dependency-chain'
const openDependencies = async (user) => user.click(await screen.findByRole('tab', { name: 'Dependencies' }))

describe('Dependencies tab', () => {
  afterEach(() => vi.useRealTimers())

  it('shows a skeleton, then the timeline in dependency order with the longest chain', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const db = seedData()
    const server = signedInAs('manager', {
      db,
      routes: { [CHAIN_PATH]: () => gate.then(() => reply(200, {
        project_id: 'p-1',
        nodes: db.deliverables.filter((d) => d.project_id === 'p-1')
          .map(({ id, name, status, start_date, due_date }, i) => ({ id, name, status, start_date, due_date, depth: i })),
        edges: [{ from: 'd-1', to: 'd-2' }, { from: 'd-2', to: 'd-3' }],
        order: ['d-1', 'd-2', 'd-3'],
        longest_chain: ['d-1', 'd-2', 'd-3'],
      })) },
    })
    const { user } = renderApp('/projects/p-1')
    await openDependencies(user)
    expect(await screen.findByRole('status', { name: 'Loading dependencies' })).toBeInTheDocument()
    release()

    const chart = await screen.findByRole('group', { name: 'Dependency timeline' })
    expect(screen.queryByRole('status', { name: 'Loading dependencies' })).not.toBeInTheDocument()
    expect(within(chart).getAllByRole('img').map((b) => b.getAttribute('aria-label').split(':')[0]))
      .toEqual(['API spec', 'Backend', 'Frontend'])
    expect(screen.getByText('Longest chain:').parentElement).toHaveTextContent('API spec → Backend → Frontend')
    expect(server.calls.find((c) => c.path === '/api/reports/dependency-chain').query).toBe('?project_id=p-1')
  })

  it('marks overdue and blocked deliverables against today’s date', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-10T12:00:00Z'))
    signedInAs('admin')
    const { user } = renderApp('/projects/p-1')
    await openDependencies(user)
    const chart = await screen.findByRole('group', { name: 'Dependency timeline' })
    expect(within(chart).getByRole('img', { name: /^Frontend: not started, overdue, blocked/ })).toBeInTheDocument()
    expect(within(chart).getByRole('img', { name: /^Backend: in progress, starts/ })).toBeInTheDocument()
  })

  it('an employee can read it, with no buttons in it', async () => {
    signedInAs('employee')
    const { user } = renderApp('/projects/p-1')
    await openDependencies(user)
    await screen.findByRole('group', { name: 'Dependency timeline' })
    expect(within(screen.getByRole('tabpanel')).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Deliverables in dependency order' })).toBeInTheDocument()
  })

  it('a project with no deliverables says so', async () => {
    signedInAs('admin', {
      routes: { [CHAIN_PATH]: () => reply(200, { project_id: 'p-1', nodes: [], edges: [], order: [], longest_chain: [] }) },
    })
    const { user } = renderApp('/projects/p-1')
    await openDependencies(user)
    expect(await screen.findByText('No deliverables yet.')).toBeInTheDocument()
  })

  it('an error shows a fixed message, and Try again loads it', async () => {
    let fail = true
    const db = seedData()
    signedInAs('admin', {
      db,
      routes: {
        [CHAIN_PATH]: () => (fail
          ? reply(500, { error: { code: 'x', message: 'raw server text' } })
          : reply(200, {
            project_id: 'p-1', nodes: [{ id: 'd-1', name: 'API spec', status: 'done', start_date: '2026-11-02',
              due_date: '2026-11-06', depth: 0 }], edges: [], order: ['d-1'], longest_chain: ['d-1'],
          })),
      },
    })
    const { user } = renderApp('/projects/p-1')
    await openDependencies(user)
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument()
    expect(screen.queryByText(/raw server text/)).not.toBeInTheDocument()
    fail = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('img', { name: /^API spec/ })).toBeInTheDocument()
  })

  it('on a phone it is a list, not a chart', async () => {
    signedInAs('manager')
    const { user } = renderApp('/projects/p-1', { width: 390 })
    await openDependencies(user)
    const list = await screen.findByRole('list', { name: 'Deliverables in dependency order' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(within(list).getByText('Waits for API spec')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Dependency timeline' })).not.toBeInTheDocument()
  })
})

describe('Project header: budget bar', () => {
  const budget = (fields) => ({
    'GET /api/projects/p-1/budget': () => reply(200, {
      project_id: 'p-1', planned_budget: 12000, committed_cost: 9977.73, used_cost_to_date: 3090.78,
      percent_used: 25.8, over_budget: false, allocated_people: 3, hidden_reason: null, ...fields,
    }),
  })

  it('shows the share of the planned budget used, as a bar and in words', async () => {
    signedInAs('admin')
    renderApp('/projects/p-1')
    const bar = await screen.findByRole('progressbar', { name: 'Budget used' })
    expect(bar).toHaveAttribute('aria-valuenow', '25.8')
    expect(screen.getByText('25.8% of the planned budget used')).toBeInTheDocument()
    // The text E2E looks for stays as it was.
    expect(screen.getByText(/Platform · Manager: Max Manager · Nov 2, 2026 – Mar 31, 2027/)).toBeInTheDocument()
  })

  it('over budget says so in words; the bar stops at 100', async () => {
    signedInAs('manager', { routes: budget({ percent_used: 130.5, over_budget: true }) })
    renderApp('/projects/p-1')
    expect(await screen.findByText('130.5% of the planned budget used · Over budget')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Budget used' })).toHaveAttribute('aria-valuenow', '100')
  })

  it('hidden totals show a note and no figure, even if one was sent', async () => {
    signedInAs('manager', { routes: budget({ percent_used: 41.5, hidden_reason: 'below_min_group' }) })
    renderApp('/projects/p-1')
    expect(await screen.findByText('Budget progress is hidden to protect individual pay.')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByText(/41\.5/)).not.toBeInTheDocument()
  })

  it.each([
    [{ planned_budget: null, percent_used: null, over_budget: null }, 'No planned budget set.'],
    [{ planned_budget: 0, percent_used: null, over_budget: true }, 'No percentage to show: the planned budget is 0.'],
  ])('without a usable planned budget it says why (%#)', async (fields, sentence) => {
    signedInAs('admin', { routes: budget(fields) })
    renderApp('/projects/p-1')
    expect(await screen.findByText(sentence)).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('a failed load says so without blanking the page, and can be retried', async () => {
    let fail = true
    const server = signedInAs('manager', {
      routes: {
        'GET /api/projects/p-1/budget': () => (fail
          ? reply(500, { error: { code: 'x', message: 'raw 90000' } })
          : budget({})['GET /api/projects/p-1/budget']()),
      },
    })
    const { user } = renderApp('/projects/p-1')
    expect(await screen.findByText("The budget summary didn't load.")).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Deliverables' })).toBeInTheDocument()
    fail = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('progressbar', { name: 'Budget used' })).toBeInTheDocument()
    expect(server.count('GET', '/api/projects/p-1/budget')).toBe(2)
  })

  it('an employee gets no budget bar and no budget call', async () => {
    const server = signedInAs('employee')
    renderApp('/projects/p-1')
    await screen.findByRole('table', { name: 'Deliverables' })
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    await waitFor(() => expect(server.count('GET', '/api/projects/p-1/budget')).toBe(0))
  })
})
