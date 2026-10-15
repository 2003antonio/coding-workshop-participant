import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reply, signedInAs } from '../test/fakeApiServer'
import { choose, headersOf, renderApp, rowFor } from '../test/renderApp'
import { VIEW_KEY } from './ProjectsPage'

const projectsTable = () => screen.findByRole('table', { name: 'Projects' })
const searchBox = () => screen.getByRole('searchbox', { name: 'Search projects' })
/** The q of every project list request so far (null when none was sent). */
const sentQueries = (server) => server.calls.filter((c) => c.path === '/api/projects/' && c.method === 'GET')
  .map((c) => new URLSearchParams(c.query).get('q'))

const team = { id: 't-1', name: 'Platform' }
const VISIBLE = [
  { id: 'p-1', team, manager: { id: 'u-2', name: 'Max Manager' }, name: 'Billing v2', description: 'New invoices',
    status: 'active', start_date: '2026-11-02', end_date: '2027-03-31', archived_at: null, planned_budget: 12000 },
  { id: 'p-2', team: { id: 't-2', name: 'Data' }, manager: { id: 'u-6', name: 'Mia Manager' }, name: 'Data Lake',
    description: '', status: 'planned', start_date: '2026-11-02', end_date: '2027-02-26', archived_at: null, planned_budget: null },
]
/**
 * Signed in as admin, with GET /api/projects/ searching like the server (§4):
 * q matches name or description, case-insensitive. hold(q, answer) may return
 * a promise to answer later (a slow reply).
 */
function searchable({ hold } = {}) {
  const server = signedInAs('admin', {
    routes: {
      'GET /api/projects/': () => {
        const q = new URLSearchParams(server.calls.at(-1).query).get('q')
        const needle = q?.toLowerCase()
        const rows = VISIBLE.filter((p) => !needle || `${p.name}
${p.description}`.toLowerCase().includes(needle))
        const answer = reply(200, { projects: rows })
        return hold ? hold(q, answer) : answer
      },
    },
  })
  return server
}

const lastList = (server) => server.calls.filter((c) => c.path === '/api/projects/' && c.method === 'GET').at(-1)

describe('Projects list: what each role sees', () => {
  it('admin sees every active project with team, manager, status and dates', async () => {
    signedInAs('admin')
    renderApp('/projects')
    await projectsTable()
    expect(headersOf('Projects')).toEqual(['Project', 'Team', 'Manager', 'Status', 'Dates', 'Actions'])
    const billing = rowFor('Billing v2')
    expect(within(billing).getByText('Platform')).toBeInTheDocument()
    expect(within(billing).getByText('Max Manager')).toBeInTheDocument()
    expect(within(billing).getByText('Active')).toBeInTheDocument()
    expect(within(billing).getByText('Nov 2, 2026 – Mar 31, 2027')).toBeInTheDocument()
    expect(rowFor('Data Lake')).toBeInTheDocument()
    expect(screen.queryByText('Old Portal')).not.toBeInTheDocument() // archived
    expect(screen.getByRole('button', { name: 'Archive Billing v2' })).toBeInTheDocument()
  })

  it('manager sees only their teams’ projects and can archive them', async () => {
    signedInAs('manager')
    renderApp('/projects')
    await projectsTable()
    expect(rowFor('Billing v2')).toBeInTheDocument()
    expect(screen.queryByText('Data Lake')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Archive Billing v2' })).toBeInTheDocument()
  })

  it('employee sees the projects they are assigned to, read-only', async () => {
    signedInAs('employee')
    renderApp('/projects')
    await projectsTable()
    expect(headersOf('Projects')).toEqual(['Project', 'Team', 'Manager', 'Status', 'Dates'])
    expect(rowFor('Billing v2')).toBeInTheDocument()
    expect(rowFor('Data Lake')).toBeInTheDocument() // assigned there too, on another team
    expect(screen.queryByRole('button', { name: /archive|new project/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Show archived' })).not.toBeInTheDocument()
  })

  it('employee with no assignments gets an empty state', async () => {
    signedInAs('u-8')
    renderApp('/projects')
    expect(await screen.findByText('No projects to show yet.')).toBeInTheDocument()
  })
})

describe('Projects list: search and filters', () => {
  it('status and team filters ask the server', async () => {
    const server = signedInAs('admin')
    const { user } = renderApp('/projects')
    await projectsTable()

    await choose(user, 'Status', 'Planned')
    await waitFor(() => expect(lastList(server).query).toBe('?status=planned'))
    await waitFor(() => expect(screen.queryByText('Billing v2')).not.toBeInTheDocument())
    expect(rowFor('Data Lake')).toBeInTheDocument()

    await choose(user, 'Status', 'All statuses')
    await choose(user, 'Team', 'Platform')
    await waitFor(() => expect(lastList(server).query).toBe('?team_id=t-1'))
    await waitFor(() => expect(screen.queryByText('Data Lake')).not.toBeInTheDocument())
  })

  it('show archived asks for archived projects and marks them', async () => {
    const server = signedInAs('admin')
    const { user } = renderApp('/projects')
    await projectsTable()
    await user.click(screen.getByRole('switch', { name: 'Show archived' }))
    await waitFor(() => expect(within(rowFor('Old Portal')).getByText('Archived')).toBeInTheDocument())
    expect(lastList(server).query).toBe('?include_archived=true')
    expect(within(rowFor('Old Portal')).queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('Projects list: server-side search', () => {
  afterEach(() => vi.useRealTimers())

  it('sends ?q= 300 ms after the last key, and filters nothing in the browser', async () => {
    const server = searchable()
    renderApp('/projects')
    await projectsTable()
    expect(sentQueries(server)).toEqual([null])

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.change(searchBox(), { target: { value: 'Inv' } })
    await act(() => vi.advanceTimersByTimeAsync(200))
    fireEvent.change(searchBox(), { target: { value: '  Invoices ' } }) // another key: the wait starts again
    await act(() => vi.advanceTimersByTimeAsync(299))
    expect(sentQueries(server)).toEqual([null]) // nothing yet: 299 ms after the last key
    await act(() => vi.advanceTimersByTimeAsync(1))
    await vi.waitFor(() => expect(sentQueries(server)).toEqual([null, 'Invoices'])) // once, trimmed
    vi.useRealTimers()

    await waitFor(() => expect(screen.queryByText('Data Lake')).not.toBeInTheDocument())
    expect(rowFor('Billing v2')).toBeInTheDocument()
  })

  it('a blank search sends no q', async () => {
    const server = searchable()
    const { user } = renderApp('/projects')
    await projectsTable()
    await user.type(searchBox(), 'lake')
    await waitFor(() => expect(sentQueries(server).at(-1)).toBe('lake'))
    await user.clear(searchBox())
    await user.type(searchBox(), '   ')
    await waitFor(() => expect(sentQueries(server).at(-1)).toBeNull())
    expect(lastList(server).query).toBe('')
    expect(await screen.findByRole('rowheader', { name: /Billing v2/ })).toBeInTheDocument()
  })

  it('a slow reply to an older search never replaces a newer one', async () => {
    let releaseOld
    const server = searchable({
      hold: (q, answer) => (q === 'bil' ? new Promise((resolve) => { releaseOld = () => resolve(answer) }) : answer),
    })
    const { user } = renderApp('/projects')
    await projectsTable()
    await user.type(searchBox(), 'bil')
    await waitFor(() => expect(sentQueries(server)).toContain('bil'))
    // While it reloads, the box stays mounted and focused; only the list shows the skeleton.
    expect(screen.getByRole('status', { name: 'Loading projects' })).toBeInTheDocument()
    expect(searchBox()).toHaveFocus()

    await user.clear(searchBox())
    await user.type(searchBox(), 'lake')
    expect(await screen.findByRole('rowheader', { name: /Data Lake/ })).toBeInTheDocument()
    await act(async () => releaseOld()) // the old answer (Billing v2) arrives last
    expect(screen.queryByText('Billing v2')).not.toBeInTheDocument()
    expect(rowFor('Data Lake')).toBeInTheDocument()
  })

  it('no match says so; the clear button empties the box, keeps focus and shows everything again', async () => {
    const server = searchable()
    const { user } = renderApp('/projects')
    await projectsTable()
    const box = searchBox()
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument()
    await user.type(box, 'zzz')
    expect(await screen.findByText("No projects match 'zzz'.")).toBeInTheDocument()
    expect(searchBox()).toBe(box) // the same box, never swapped for a skeleton
    expect(box).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(box).toHaveValue('')
    expect(box).toHaveFocus()
    expect(await screen.findByRole('rowheader', { name: /Billing v2/ })).toBeInTheDocument()
    expect(lastList(server).query).toBe('')
  })

  it('sends at most 100 characters (the server limit)', async () => {
    const server = searchable()
    renderApp('/projects')
    await projectsTable()
    expect(searchBox()).toHaveAttribute('maxlength', '100')
    fireEvent.change(searchBox(), { target: { value: `${'x'.repeat(150)}` } }) // e.g. a paste past maxlength
    await waitFor(() => expect(sentQueries(server).at(-1)).toHaveLength(100))
  })
})

describe('Projects list: actions', () => {
  it('archive asks first, then archives and reloads', async () => {
    const server = signedInAs('manager')
    const { user } = renderApp('/projects')
    await projectsTable()
    await user.click(screen.getByRole('button', { name: 'Archive Billing v2' }))
    const dialog = await screen.findByRole('dialog', { name: 'Archive Billing v2?' })
    expect(dialog).toHaveAccessibleDescription(/deliverables and assignments are archived too/i)
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }))

    expect(await screen.findByText('Billing v2 was archived.')).toBeInTheDocument()
    expect(server.count('POST', '/api/projects/p-1/archive')).toBe(1)
    expect(await screen.findByText('No projects to show yet.')).toBeInTheDocument()
  })

  it('a failed archive keeps the dialog open with a fixed message', async () => {
    signedInAs('admin', {
      routes: { 'POST /api/projects/p-1/archive': () => reply(409, { error: { code: 'already_archived', message: 'raw' } }) },
    })
    const { user } = renderApp('/projects')
    await projectsTable()
    await user.click(screen.getByRole('button', { name: 'Archive Billing v2' }))
    const dialog = await screen.findByRole('dialog', { name: 'Archive Billing v2?' })
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }))
    expect(await within(dialog).findByText('That is already archived.')).toBeInTheDocument()
  })

  it('New project validates, creates and opens the new project', async () => {
    const server = signedInAs('manager')
    const { user } = renderApp('/projects')
    await projectsTable()
    await user.click(screen.getByRole('button', { name: 'New project' }))
    const dialog = await screen.findByRole('dialog', { name: 'New project' })
    // A manager leading one team gets it picked already.
    expect(within(dialog).getByRole('combobox', { name: /team/i })).toHaveTextContent('Platform')

    await user.click(within(dialog).getByRole('button', { name: 'Create project' }))
    expect(within(dialog).getByText('Enter a project name.')).toBeInTheDocument()
    expect(within(dialog).getByText('Choose a start date.')).toBeInTheDocument()

    await user.type(within(dialog).getByRole('textbox', { name: /project name/i }), 'Mobile app')
    await user.type(within(dialog).getByLabelText(/start date/i), '2027-01-04')
    await user.type(within(dialog).getByLabelText(/end date/i), '2026-12-01')
    await user.click(within(dialog).getByRole('button', { name: 'Create project' }))
    expect(within(dialog).getByText('End on or after the start date.')).toBeInTheDocument()

    await user.clear(within(dialog).getByLabelText(/end date/i))
    await user.type(within(dialog).getByLabelText(/end date/i), '2027-06-30')
    await user.click(within(dialog).getByRole('button', { name: 'Create project' }))

    expect(await screen.findByRole('heading', { name: 'Mobile app' })).toBeInTheDocument()
    expect(server.calls.find((c) => c.method === 'POST' && c.path === '/api/projects/').body).toEqual({
      team_id: 't-1', name: 'Mobile app', description: '', status: 'planned',
      start_date: '2027-01-04', end_date: '2027-06-30',
    })
  })

  it('New project can carry an optional planned budget', async () => {
    const server = signedInAs('admin')
    const { user } = renderApp('/projects')
    await projectsTable()
    await user.click(screen.getByRole('button', { name: 'New project' }))
    const dialog = await screen.findByRole('dialog', { name: 'New project' })
    await choose(user, /team/i, 'Data', dialog)
    await user.type(within(dialog).getByRole('textbox', { name: /project name/i }), 'Warehouse')
    await user.type(within(dialog).getByLabelText(/start date/i), '2027-01-04')
    await user.type(within(dialog).getByLabelText(/end date/i), '2027-06-30')
    await user.type(within(dialog).getByRole('textbox', { name: /planned budget/i }), '99999999999')
    await user.click(within(dialog).getByRole('button', { name: 'Create project' }))
    expect(within(dialog).getByText('Enter an amount up to 9,999,999,999.99.')).toBeInTheDocument()

    await user.clear(within(dialog).getByRole('textbox', { name: /planned budget/i }))
    await user.type(within(dialog).getByRole('textbox', { name: /planned budget/i }), '52000')
    await user.click(within(dialog).getByRole('button', { name: 'Create project' }))
    expect(await screen.findByRole('heading', { name: 'Warehouse' })).toBeInTheDocument()
    expect(server.calls.find((c) => c.method === 'POST' && c.path === '/api/projects/').body).toMatchObject({
      team_id: 't-2', name: 'Warehouse', planned_budget: 52000,
    })
  })

  it('a failed load shows a fixed message, never the server text', async () => {
    signedInAs('admin', {
      routes: { 'GET /api/projects/': () => reply(503, { error: { code: 'unavailable', message: 'raw: db down' } }) },
    })
    renderApp('/projects')
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument()
    expect(screen.queryByText(/db down/)).not.toBeInTheDocument()
  })

  it('shows cards on a phone', async () => {
    signedInAs('admin')
    renderApp('/projects', { width: 400 })
    const list = await screen.findByRole('list', { name: 'Projects' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getByRole('link', { name: 'Billing v2' })).toBeInTheDocument()
  })
})

describe('Projects: table or cards', () => {
  it('starts as a table, switches to cards and remembers the choice', async () => {
    signedInAs('admin')
    const { user, unmount } = renderApp('/projects')
    expect(await screen.findByRole('table', { name: 'Projects' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cards' }))
    const cards = await screen.findByRole('list', { name: 'Projects' })
    expect(within(cards).getByRole('link', { name: 'Billing v2' })).toBeInTheDocument()
    expect(within(cards).getByRole('button', { name: 'Archive Billing v2' })).toBeInTheDocument()
    expect(window.localStorage.getItem(VIEW_KEY)).toBe('cards')

    unmount()
    renderApp('/projects')
    expect(await screen.findByRole('list', { name: 'Projects' })).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Projects' })).not.toBeInTheDocument()
  })
})
