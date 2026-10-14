import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Context as ResponsiveContext } from 'react-responsive'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { REFRESH_TOKEN_KEY } from '../auth/tokenStorage'
import { fakeAuthServer, reply } from '../test/fakeAuthServer'

const USERS = {
  admin: { id: 'u-1', email: 'ada@acme.test', name: 'Ada Admin', role: 'admin', job_title: 'Head of Ops' },
  manager: { id: 'u-2', email: 'max@acme.test', name: 'Max Manager', role: 'manager', job_title: 'Delivery Lead' },
  employee: { id: 'u-3', email: 'eve@acme.test', name: 'Eve Employee', role: 'employee', job_title: 'Engineer' },
}
const SALARIES = { 'u-1': 150000, 'u-2': 120000, 'u-3': 90000.5 }

/** The list as the server returns it to each role: salary and archived_at for admins only. */
function listFor(role, extra = []) {
  const rows = [...Object.values(USERS), ...extra].map(({ id, name, email, job_title, role: r }) => ({
    id, name, email, job_title, role: r,
  }))
  if (role !== 'admin') return { employees: rows }
  return {
    employees: rows.map((row) => ({
      ...row, salary: SALARIES[row.id] ?? 1000, archived_at: row.archived_at ?? null,
    })),
  }
}

/** Restore a signed-in session as `role` (via the stored refresh token), plus extra routes. */
function signedInAs(role, routes = {}) {
  window.localStorage.setItem(REFRESH_TOKEN_KEY, 'stored-refresh')
  let refreshes = 0
  return fakeAuthServer({
    'POST /api/auth/refresh': () => {
      refreshes += 1
      return reply(200, { access_token: `access-${refreshes}`, refresh_token: `refresh-${refreshes}` })
    },
    'GET /api/auth/me': () => reply(200, USERS[role]),
    'GET /api/employees/': () => reply(200, listFor(role)),
    ...routes,
  })
}

function renderApp(path, { width } = {}) {
  const app = (
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  )
  return render(width ? <ResponsiveContext.Provider value={{ width }}>{app}</ResponsiveContext.Provider> : app)
}

const table = () => screen.findByRole('table', { name: 'Employees' })
const columnHeaders = () => screen.getAllByRole('columnheader').map((th) => th.textContent)
const rowFor = (name) => screen.getByRole('rowheader', { name: new RegExp(name) }).closest('tr')

describe('Employees page: what each role sees', () => {
  it('admin sees salaries and the Add, Edit and Archive buttons', async () => {
    const server = signedInAs('admin')
    renderApp('/employees')

    await table()
    expect(columnHeaders()).toEqual(['Name', 'Email', 'Job title', 'Role', 'Salary', 'Actions'])
    expect(within(rowFor('Eve Employee')).getByText('90,000.50')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add employee' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Eve Employee' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Archive Eve Employee' })).toBeEnabled()
    expect(screen.getByRole('switch', { name: 'Show archived' })).not.toBeChecked()
    // The list call used the access token from the restored session.
    const listCall = server.calls.find((c) => c.path === '/api/employees/')
    expect(listCall.headers.Authorization).toBe('Bearer access-1')
    expect(listCall.query).toBe('')
  })

  it('admin cannot archive their own account', async () => {
    signedInAs('admin')
    renderApp('/employees')
    await table()
    expect(screen.getByRole('button', { name: 'Archive Ada Admin' })).toBeDisabled()
  })

  it('manager sees the list without salaries or any edit buttons', async () => {
    signedInAs('manager')
    renderApp('/employees')

    await table()
    expect(columnHeaders()).toEqual(['Name', 'Email', 'Job title', 'Role'])
    expect(screen.getAllByRole('row')).toHaveLength(4) // header + 3 people
    expect(screen.queryByText(/90,000|150,000/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add employee|edit|archive/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Show archived' })).not.toBeInTheDocument()
  })

  it('employee is told they have no access, and nothing is requested', async () => {
    const server = signedInAs('employee')
    renderApp('/employees')

    expect(await screen.findByText(/don't have permission to view the employee list/i)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(server.count('GET', '/api/employees/')).toBe(0)
  })
})

describe('navigation', () => {
  it.each([['admin'], ['manager']])('%s gets an Employees link on the home page that opens the list', async (role) => {
    signedInAs(role)
    renderApp('/')
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    await userEvent.setup().click(within(nav).getByRole('link', { name: 'Employees' }))

    expect(await table()).toBeInTheDocument()
    // The Employees page renders its own app bar, so look the navigation up again.
    const newNav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(newNav).getByRole('link', { name: 'Employees' })).toHaveAttribute('aria-current', 'page')
    expect(within(newNav).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
  })

  it('employee has no Employees link', async () => {
    signedInAs('employee')
    renderApp('/')
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Home' })).toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: 'Employees' })).not.toBeInTheDocument()
  })
})

describe('expired access token', () => {
  it('refreshes the session once and retries the list once', async () => {
    let listCalls = 0
    const server = signedInAs('admin', {
      'GET /api/employees/': () => {
        listCalls += 1
        return listCalls === 1
          ? reply(401, { error: { code: 'token_expired', message: 'Token expired.' } })
          : reply(200, listFor('admin'))
      },
    })
    renderApp('/employees')

    await table()
    expect(server.count('GET', '/api/employees/')).toBe(2)
    expect(server.count('POST', '/api/auth/refresh')).toBe(2) // 1 to restore the session, 1 to retry
    const lists = server.calls.filter((c) => c.path === '/api/employees/')
    expect(lists.map((c) => c.headers.Authorization)).toEqual(['Bearer access-1', 'Bearer access-2'])
  })

  it('if the refresh is rejected, the user is sent to sign in', async () => {
    let refreshes = 0
    signedInAs('admin', {
      'POST /api/auth/refresh': () => {
        refreshes += 1
        return refreshes === 1
          ? reply(200, { access_token: 'access-1', refresh_token: 'refresh-1' })
          : reply(401, { error: { code: 'invalid_token', message: 'Invalid refresh token.' } })
      },
      'GET /api/employees/': () => reply(401, { error: { code: 'token_expired', message: 'x' } }),
    })
    renderApp('/employees')

    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument()
    expect(window.localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull()
  })
})

describe('errors', () => {
  it('a failed load shows a friendly message, never the server text', async () => {
    signedInAs('admin', {
      'GET /api/employees/': () => reply(500, { error: { code: 'internal_error', message: 'raw: salary column' } }),
    })
    renderApp('/employees')

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument()
    expect(screen.queryByText(/raw: salary column/)).not.toBeInTheDocument()
  })
})

describe('admin actions', () => {
  it('Add employee checks the form, POSTs it, then reloads the list', async () => {
    const server = signedInAs('admin', {
      'POST /api/employees/': (body) => reply(201, { ...body, id: 'u-9', archived_at: null }),
    })
    const user = userEvent.setup()
    renderApp('/employees')
    await table()

    await user.click(screen.getByRole('button', { name: 'Add employee' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add employee' })

    // Empty form: errors shown next to the fields, nothing sent.
    await user.click(within(dialog).getByRole('button', { name: 'Add employee' }))
    expect(within(dialog).getByText('Enter a name.')).toBeInTheDocument()
    expect(within(dialog).getByText('Use at least 12 characters.')).toBeInTheDocument()
    expect(within(dialog).getByRole('textbox', { name: /name/i })).toHaveAttribute('aria-invalid', 'true')
    expect(server.count('POST', '/api/employees/')).toBe(0)

    await user.type(within(dialog).getByRole('textbox', { name: /^name/i }), 'Nia New')
    await user.type(within(dialog).getByRole('textbox', { name: /email/i }), 'nia@acme.test')
    await user.type(within(dialog).getByRole('textbox', { name: /job title/i }), 'Analyst')
    await user.click(within(dialog).getByRole('combobox', { name: /role/i }))
    await user.click(await screen.findByRole('option', { name: 'Manager' }))
    await user.type(within(dialog).getByRole('textbox', { name: /salary/i }), '70000.5')
    await user.type(within(dialog).getByLabelText(/initial password/i), 'Initial-Pass-2024')
    await user.click(within(dialog).getByRole('button', { name: 'Add employee' }))

    expect(await screen.findByText('Nia New was added.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const post = server.calls.find((c) => c.method === 'POST' && c.path === '/api/employees/')
    expect(post.body).toEqual({
      name: 'Nia New', email: 'nia@acme.test', job_title: 'Analyst', role: 'manager',
      salary: 70000.5, password: 'Initial-Pass-2024',
    })
    await waitFor(() => expect(server.count('GET', '/api/employees/')).toBe(2))
  })

  it('a duplicate email keeps the dialog open with a clear message', async () => {
    signedInAs('admin', {
      'POST /api/employees/': () => reply(409, { error: { code: 'email_taken', message: 'raw text' } }),
    })
    const user = userEvent.setup()
    renderApp('/employees')
    await table()
    await user.click(screen.getByRole('button', { name: 'Add employee' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add employee' })

    await user.type(within(dialog).getByRole('textbox', { name: /^name/i }), 'Eve Again')
    await user.type(within(dialog).getByRole('textbox', { name: /email/i }), 'EVE@acme.test')
    await user.type(within(dialog).getByRole('textbox', { name: /job title/i }), 'Engineer')
    await user.type(within(dialog).getByRole('textbox', { name: /salary/i }), '1')
    await user.type(within(dialog).getByLabelText(/initial password/i), 'Initial-Pass-2024')
    await user.click(within(dialog).getByRole('button', { name: 'Add employee' }))

    expect(await within(dialog).findByText('An employee with that email already exists.')).toBeInTheDocument()
    expect(screen.queryByText('raw text')).not.toBeInTheDocument()
  })

  it('Edit opens a filled-in form and PUTs the four editable fields', async () => {
    const server = signedInAs('admin', {
      'PUT /api/employees/u-3': (body) => reply(200, { ...USERS.employee, ...body }),
    })
    const user = userEvent.setup()
    renderApp('/employees')
    await table()

    await user.click(screen.getByRole('button', { name: 'Edit Eve Employee' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Eve Employee' })
    expect(within(dialog).queryByRole('textbox', { name: /email/i })).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText(/password/i)).not.toBeInTheDocument()
    const jobTitle = within(dialog).getByRole('textbox', { name: /job title/i })
    expect(jobTitle).toHaveValue('Engineer')

    await user.clear(jobTitle)
    await user.type(jobTitle, 'Senior Engineer')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Eve Employee was updated.')).toBeInTheDocument()
    const put = server.calls.find((c) => c.method === 'PUT')
    expect(put.body).toEqual({ name: 'Eve Employee', job_title: 'Senior Engineer', role: 'employee', salary: 90000.5 })
  })

  it('Archive asks first, then POSTs to /archive', async () => {
    const server = signedInAs('admin', {
      'POST /api/employees/u-3/archive': () => reply(200, { ...USERS.employee, archived_at: '2026-10-14' }),
    })
    const user = userEvent.setup()
    renderApp('/employees')
    await table()

    await user.click(screen.getByRole('button', { name: 'Archive Eve Employee' }))
    const dialog = await screen.findByRole('dialog', { name: 'Archive Eve Employee?' })
    expect(dialog).toHaveAccessibleDescription(/no longer be able to sign in/i)
    expect(server.count('POST', '/api/employees/u-3/archive')).toBe(0)

    await user.click(within(dialog).getByRole('button', { name: 'Archive' }))
    expect(await screen.findByText('Eve Employee was archived.')).toBeInTheDocument()
    expect(server.count('POST', '/api/employees/u-3/archive')).toBe(1)
  })

  it('Show archived asks the server for archived employees and marks them', async () => {
    const OLD = { id: 'u-8', name: 'Old Timer', email: 'old@acme.test', job_title: 'Retired', role: 'employee' }
    const server = signedInAs('admin', {
      'GET /api/employees/': () => {
        const withArchived = server.calls.at(-1).query === '?include_archived=true'
        const data = listFor('admin', withArchived ? [OLD] : [])
        if (withArchived) data.employees.at(-1).archived_at = '2026-01-01T00:00:00+00:00'
        return reply(200, data)
      },
    })
    const user = userEvent.setup()
    renderApp('/employees')
    await table()
    expect(screen.queryByText('Old Timer')).not.toBeInTheDocument()

    await user.click(screen.getByRole('switch', { name: 'Show archived' }))

    const oldRow = await waitFor(() => rowFor('Old Timer'))
    expect(within(oldRow).getByText('Archived')).toBeInTheDocument()
    expect(within(oldRow).queryByRole('button')).not.toBeInTheDocument()
    expect(server.calls.at(-1).query).toBe('?include_archived=true')
  })
})

describe('phone layout', () => {
  it('moves email and job title under the name instead of separate columns', async () => {
    signedInAs('admin')
    renderApp('/employees', { width: 400 })

    await table()
    expect(columnHeaders()).toEqual(['Name', 'Role', 'Salary', 'Actions'])
    expect(within(rowFor('Eve Employee')).getByText(/eve@acme\.test/)).toBeInTheDocument()
  })
})
