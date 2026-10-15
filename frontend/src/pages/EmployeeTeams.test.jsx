import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { REFRESH_TOKEN_KEY } from '../auth/tokenStorage'
import { reply, signedInAs } from '../test/fakeApiServer'
import { choose, renderApp, rowFor } from '../test/renderApp'
import { teamLabel } from './people'

const table = () => screen.findByRole('table', { name: 'Employees' })
const teamCell = (name) => within(rowFor(name)).getAllByRole('cell')[2] // email, job title, team

describe('Employees page: teams', () => {
  it('shows each person’s team; a manager sees names only for teams they lead', async () => {
    signedInAs('manager')
    renderApp('/employees')
    await table()
    await waitFor(() => expect(teamCell('Eve Employee')).toHaveTextContent('Platform'))
    expect(teamCell('Dee Data')).toHaveTextContent('Other team')
    expect(teamCell('Nia New')).toHaveTextContent('No team')
  })

  it('adding an employee with a team adds them to it', async () => {
    const server = signedInAs('admin')
    const { user } = renderApp('/employees')
    await table()
    await user.click(screen.getByRole('button', { name: 'Add employee' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add employee' })
    await user.type(within(dialog).getByRole('textbox', { name: /^name/i }), 'Kai Kim')
    await user.type(within(dialog).getByRole('textbox', { name: /email/i }), 'kai@acme.test')
    await user.type(within(dialog).getByRole('textbox', { name: /job title/i }), 'Engineer')
    await choose(user, /team/i, 'Data', dialog)
    await user.type(within(dialog).getByRole('textbox', { name: /salary/i }), '80000')
    await user.type(within(dialog).getByLabelText(/initial password/i), 'Initial-Pass-2024')
    await user.click(within(dialog).getByRole('button', { name: 'Add employee' }))

    expect(await screen.findByText('Kai Kim was added.')).toBeInTheDocument()
    const post = server.calls.find((c) => c.method === 'POST' && c.path === '/api/employees/')
    expect(post.body).not.toHaveProperty('team_id') // membership is not part of the employee record
    const member = server.calls.find((c) => c.path === '/api/teams/t-2/members')
    expect(member.body).toEqual({ employee_id: server.db.employees.at(-1).id })
    await waitFor(() => expect(teamCell('Kai Kim')).toHaveTextContent('Data'))
  })

  it('moving someone to another team removes them from the old one first', async () => {
    const server = signedInAs('admin')
    const { user } = renderApp('/employees')
    await table()
    await user.click(screen.getByRole('button', { name: 'Edit Eve Employee' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Eve Employee' })
    expect(within(dialog).getByRole('combobox', { name: /team/i })).toHaveTextContent('Platform')
    await choose(user, /team/i, 'Data', dialog)
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Eve Employee was updated.')).toBeInTheDocument()
    const teamCalls = server.calls.filter((c) => c.path.includes('/members'))
    expect(teamCalls.map((c) => `${c.method} ${c.path}`))
      .toEqual(['DELETE /api/teams/t-1/members/u-3', 'POST /api/teams/t-2/members'])
    await waitFor(() => expect(teamCell('Eve Employee')).toHaveTextContent('Data'))
  })

  it('leaving the team unchanged makes no membership calls; "No team" removes', async () => {
    const server = signedInAs('admin')
    const { user } = renderApp('/employees')
    await table()
    await user.click(screen.getByRole('button', { name: 'Edit Bo Builder' }))
    let dialog = await screen.findByRole('dialog', { name: 'Edit Bo Builder' })
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await screen.findByText('Bo Builder was updated.')
    expect(server.calls.filter((c) => c.path.includes('/members'))).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Edit Bo Builder' }))
    dialog = await screen.findByRole('dialog', { name: 'Edit Bo Builder' })
    await choose(user, /team/i, 'No team', dialog)
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(server.count('DELETE', '/api/teams/t-1/members/u-4')).toBe(1))
    expect(server.count('POST', '/api/teams/t-1/members')).toBe(0)
  })

  it('a lead is not offered the team they lead', async () => {
    signedInAs('admin')
    const { user } = renderApp('/employees')
    await table()
    await user.click(screen.getByRole('button', { name: 'Edit Max Manager' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Max Manager' })
    await user.click(within(dialog).getByRole('combobox', { name: /team/i }))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['No team', 'Data'])
  })

  it('if the team change is refused, the employee is still saved and a warning says why', async () => {
    signedInAs('admin', {
      routes: { 'POST /api/teams/t-2/members': () => reply(409, { error: { code: 'lead_cannot_be_member', message: 'raw' } }) },
    })
    const { user } = renderApp('/employees')
    await table()
    await user.click(screen.getByRole('button', { name: 'Edit Nia New' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Nia New' })
    await choose(user, /team/i, 'Data', dialog)
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Nia New was updated.')).toBeInTheDocument()
    expect(screen.getByText(
      'Nia New was saved, but their team was not changed: A team lead cannot also be a member of the team they lead.',
    )).toBeInTheDocument()
    expect(screen.queryByText('raw')).not.toBeInTheDocument()
  })

  it('demoting a team lead is refused with a clear message', async () => {
    signedInAs('admin')
    const { user } = renderApp('/employees')
    await table()
    await user.click(screen.getByRole('button', { name: 'Edit Max Manager' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Max Manager' })
    await choose(user, /role/i, 'Employee', dialog)
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(await within(dialog).findByText('This person leads a team. Choose a new lead for that team first.'))
      .toBeInTheDocument()
  })

  it('if teams cannot be loaded, the team field is disabled and says why', async () => {
    signedInAs('admin', { routes: { 'GET /api/teams/': () => reply(500, { error: { code: 'x' } }) } })
    const { user } = renderApp('/employees')
    await table()
    await user.click(screen.getByRole('button', { name: 'Add employee' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add employee' })
    expect(within(dialog).getByRole('combobox', { name: /team/i })).toHaveAttribute('aria-disabled', 'true')
    expect(within(dialog).getByText("Teams couldn't be loaded, so the team can't be changed now.")).toBeInTheDocument()
  })
})

// Deliberate checks: a role that may not see something must not see it, even if
// a response were ever to contain it.
describe('access rules', () => {
  it('the salary column is never shown to a manager, even if salaries were sent', async () => {
    signedInAs('manager', {
      routes: {
        'GET /api/employees/': () => reply(200, {
          employees: [{ id: 'u-3', name: 'Eve Employee', email: 'eve@acme.test', job_title: 'Engineer',
            role: 'employee', team_id: 't-1', salary: 90000.5 }],
        }),
      },
    })
    renderApp('/employees')
    await table()
    expect(screen.queryByRole('columnheader', { name: /salary/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/90,000|90000/)).not.toBeInTheDocument()
  })

  it('an employee cannot reach admin pages or admin actions', async () => {
    const server = signedInAs('employee')
    const { user } = renderApp('/employees')
    expect(await screen.findByText(/don't have permission to view the employee list/i)).toBeInTheDocument()
    expect(server.count('GET', '/api/employees/')).toBe(0)

    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Home', 'My work', 'Projects', 'Teams', 'Reports'])

    await user.click(within(nav).getByRole('link', { name: 'Teams' }))
    await screen.findByRole('list', { name: 'Teams' })
    expect(screen.queryByRole('button', { name: /new team/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Platform' }))
    await screen.findByRole('heading', { name: 'Platform' })
    expect(screen.queryByRole('button', { name: /edit team|add member|remove/i })).not.toBeInTheDocument()
    expect(server.calls.filter((c) => c.method !== 'GET' && !c.path.startsWith('/api/auth'))).toHaveLength(0)
  })

  it('on a phone the navigation is a menu with the same role-aware links', async () => {
    signedInAs('manager')
    const { user } = renderApp('/', { width: 400 })
    await screen.findByRole('heading', { name: /welcome/i })
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Menu' }))
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(nav).getAllByRole('link').map((m) => m.textContent))
      .toEqual(['Home', 'My work', 'Projects', 'Teams', 'Reports', 'Activity', 'Employees'])
    await user.click(within(nav).getByRole('link', { name: 'Projects' }))
    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument())
    expect(window.localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('refresh-1')
  })
})

describe('Employees: row look', () => {
  it('each row has an avatar beside the name, and role and team as chips', async () => {
    signedInAs('admin')
    renderApp('/employees')
    await screen.findByRole('table', { name: 'Employees' })
    const row = rowFor('Eve Employee')
    expect(row.querySelector('[data-initials="EE"]')).toHaveAttribute('aria-hidden', 'true')
    expect(within(row).getByText('Employee').closest('.MuiChip-root')).toBeInTheDocument()
    await waitFor(() => expect(within(row).getByText('Platform').closest('.MuiChip-root')).toBeInTheDocument())
  })
})

describe('Employees: leads show their team', () => {
  it('a lead shows "Leads <team>"; someone with no team and nothing to lead keeps "No team"', async () => {
    signedInAs('admin')
    const { user } = renderApp('/employees')
    await table()
    await waitFor(() => expect(teamCell('Max Manager')).toHaveTextContent('Leads Platform'))
    expect(teamCell('Mia Manager')).toHaveTextContent('Leads Data')
    expect(teamCell('Nia New')).toHaveTextContent('No team')

    await user.click(screen.getByRole('button', { name: 'Edit Max Manager' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Leads Platform. A lead is not a member of the team they lead.')).toBeInTheDocument()
  })

  it('teamLabel counts further teams as "+N"', () => {
    const teams = [{ id: 't-1', name: 'Platform', lead: { id: 'u-2' } }, { id: 't-2', name: 'Data', lead: { id: 'u-2' } }]
    expect(teamLabel({ id: 'u-2', team_id: null }, teams)).toEqual({ label: 'Leads Platform +1', kind: 'lead' })
    expect(teamLabel({ id: 'u-9', team_id: 't-2' }, teams)).toEqual({ label: 'Data', kind: 'member' })
    // A manager's list has only their own teams: another manager may lead one they can't see.
    expect(teamLabel({ id: 'u-6', role: 'manager', team_id: null }, teams, false)).toEqual({ label: '—', kind: 'unknown' })
    expect(teamLabel({ id: 'u-8', role: 'employee', team_id: null }, teams, false).label).toBe('No team')
  })
})
