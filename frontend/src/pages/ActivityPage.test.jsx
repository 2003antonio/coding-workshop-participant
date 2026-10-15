import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { groupRepeats, timeAgo } from '../components/activity/activityTime'
import { reply, signedInAs } from '../test/fakeApiServer'
import { renderApp } from '../test/renderApp'
import { PAGE_SIZE } from './ActivityPage'

const ROUTE = 'GET /api/reports/activity'
const actor = { id: 'u-1', name: 'Ada Admin', role: 'admin' }
const row = (n, type = 'projects') => ({
  id: `a-${n}`, occurred_at: new Date(Date.now() - n * 60000).toISOString(), actor, action: 'project_updated',
  type, entity_type: 'project', entity_id: 'p-1', sentence: `Ada Admin did thing ${n}`,
})
/** A fake feed of `total` rows that honours limit, offset and type, like the server. */
function feed(server, total) {
  return () => {
    const query = new URLSearchParams(server().calls.at(-1).query)
    const type = query.get('type')
    const all = Array.from({ length: total }, (_, i) => row(i + 1, i % 2 ? 'deliverables' : 'projects'))
      .filter((r) => !type || r.type === type)
    const offset = Number(query.get('offset') ?? 0)
    const limit = Number(query.get('limit') ?? 50)
    return reply(200, { activity: all.slice(offset, offset + limit), total: all.length, limit, offset })
  }
}

describe('Activity page', () => {
  it('admin sees the feed newest first, pages with "Load more" and filters by type', async () => {
    let server
    server = signedInAs('admin', { routes: { [ROUTE]: feed(() => server, 25) } })
    const { user } = renderApp('/activity')
    expect(await screen.findByRole('heading', { level: 1, name: 'Activity' })).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: 'Activity' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(PAGE_SIZE)
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('Ada Admin did thing 1')
    expect(screen.getByText(`Showing ${PAGE_SIZE} of 25`)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(25))
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
    expect(server.calls.filter((c) => c.path === '/api/reports/activity').at(-1).query).toContain('offset=20')

    const chips = screen.getByRole('group', { name: 'Filter activity' })
    expect(within(chips).getAllByRole('button').map((b) => b.textContent))
      .toEqual(['All', 'People', 'Teams', 'Projects', 'Deliverables', 'Assignments', 'Sign-ins'])
    await user.click(within(chips).getByRole('button', { name: 'Deliverables' }))
    expect(await screen.findByText('Showing 12 of 12')).toBeInTheDocument()
    expect(server.calls.at(-1).query).toContain('type=deliverables')
  })

  it('a manager gets no People, Teams or Sign-ins chips; an empty feed says so', async () => {
    signedInAs('manager', { routes: { [ROUTE]: () => reply(200, { activity: [], total: 0, limit: 20, offset: 0 }) } })
    renderApp('/activity')
    expect(await screen.findByText('Nothing has happened yet.')).toBeInTheDocument()
    expect(screen.getByText('Changes to projects and people will show up here.')).toBeInTheDocument()
    const chips = screen.getByRole('group', { name: 'Filter activity' })
    expect(within(chips).getAllByRole('button').map((b) => b.textContent))
      .toEqual(['All', 'Projects', 'Deliverables', 'Assignments'])
  })

  it('an employee has no Activity link and the page says it is not for them; errors offer a retry', async () => {
    const server = signedInAs('employee')
    renderApp('/activity')
    expect(await screen.findByText("You don't have permission to view activity.")).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Activity' })).not.toBeInTheDocument()
    expect(server.count('GET', '/api/reports/activity')).toBe(0)
  })

  it('a failed load offers "Try again"', async () => {
    signedInAs('admin', { routes: { [ROUTE]: () => reply(500, { error: { code: 'internal', message: 'x' } }) } })
    renderApp('/activity')
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('folds consecutive identical rows into one with a count', () => {
    const same = (id) => ({ id, sentence: 'A sign-in with an unknown email failed', type: 'sign-ins' })
    const grouped = groupRepeats([same('1'), same('2'), same('3'), { id: '4', sentence: 'x', type: 'teams' }, same('5')])
    expect(grouped.map((g) => [g.id, g.times])).toEqual([['1', 3], ['4', 1], ['5', 1]])
  })

  it('says times in words', () => {
    const now = Date.parse('2026-10-14T12:00:00Z')
    expect(timeAgo('2026-10-14T11:59:40Z', now)).toBe('just now')
    expect(timeAgo('2026-10-14T11:55:00Z', now)).toBe('5 minutes ago')
    expect(timeAgo('2026-10-13T12:00:00Z', now)).toBe('yesterday')
    expect(timeAgo('2026-10-11T12:00:00Z', now)).toBe('3 days ago')
  })
})
