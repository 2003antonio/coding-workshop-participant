import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { reply, signedInAs } from '../test/fakeApiServer'
import { choose, headersOf, renderApp, rowFor } from '../test/renderApp'

const projectsTable = () => screen.findByRole('table', { name: 'Projects' })
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
  it('search narrows the list by name or description without a request', async () => {
    const server = signedInAs('admin')
    const { user } = renderApp('/projects')
    await projectsTable()
    const before = server.calls.length

    await user.type(screen.getByRole('searchbox', { name: 'Search projects' }), 'invoices')
    expect(rowFor('Billing v2')).toBeInTheDocument()
    expect(screen.queryByText('Data Lake')).not.toBeInTheDocument()

    await user.clear(screen.getByRole('searchbox', { name: 'Search projects' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search projects' }), 'zzz')
    expect(screen.getByText('No projects match these filters.')).toBeInTheDocument()
    expect(server.calls.length).toBe(before)
  })

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
