import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { reply, signedInAs } from '../test/fakeApiServer'
import { choose, renderApp, rowFor } from '../test/renderApp'

describe('Teams list', () => {
  it('admin sees every team with lead and member count, and can create one', async () => {
    const server = signedInAs('admin')
    const { user } = renderApp('/teams')

    // One card per team: lead, members as avatars and their count.
    const cards = await screen.findByRole('list', { name: 'Teams' })
    const card = (name) => within(cards).getByRole('link', { name }).closest('li')
    expect(within(card('Platform')).getByText('Max Manager')).toBeInTheDocument()
    expect(await within(card('Data')).findByText('1 member')).toBeInTheDocument()
    expect(await within(card('Platform')).findByRole('img', { name: /^\d+ (person|people): / })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'New team' }))
    const dialog = await screen.findByRole('dialog', { name: 'New team' })
    await user.click(within(dialog).getByRole('button', { name: 'Create team' }))
    expect(within(dialog).getByText('Enter a team name.')).toBeInTheDocument()
    expect(within(dialog).getByText('Choose a lead.')).toBeInTheDocument()

    await user.type(within(dialog).getByRole('textbox', { name: /team name/i }), '  Mobile ')
    await choose(user, /lead/i, /Mia Manager/, dialog)
    // Employees can never be a lead, so they are not offered.
    await user.click(within(dialog).getByRole('combobox', { name: /lead/i }))
    expect(screen.queryByRole('option', { name: /Eve Employee/ })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    await user.click(within(dialog).getByRole('button', { name: 'Create team' }))

    expect(await screen.findByText('Mobile was created.')).toBeInTheDocument()
    expect(server.calls.find((c) => c.method === 'POST' && c.path === '/api/teams/').body)
      .toEqual({ name: 'Mobile', lead_id: 'u-6' })
    expect(await screen.findByRole('link', { name: 'Mobile' })).toBeInTheDocument()
  })

  it('a duplicate name keeps the dialog open with a fixed message', async () => {
    signedInAs('admin')
    const { user } = renderApp('/teams')
    await user.click(await screen.findByRole('button', { name: 'New team' }))
    const dialog = await screen.findByRole('dialog', { name: 'New team' })
    await user.type(within(dialog).getByRole('textbox', { name: /team name/i }), 'platform')
    await choose(user, /lead/i, /Mia Manager/, dialog)
    await user.click(within(dialog).getByRole('button', { name: 'Create team' }))

    expect(await within(dialog).findByText('A team with that name already exists.')).toBeInTheDocument()
    expect(screen.queryByText(/Server text/)).not.toBeInTheDocument()
  })

  it('manager sees only the teams they lead, with no admin buttons', async () => {
    const server = signedInAs('manager')
    renderApp('/teams')
    await screen.findByRole('list', { name: 'Teams' })
    expect(screen.getByRole('link', { name: 'Platform' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Data' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New team' })).not.toBeInTheDocument()
    expect(server.count('GET', '/api/employees/')).toBe(0)
  })

  it('an employee with no team sees a friendly empty state', async () => {
    signedInAs('u-8')
    renderApp('/teams')
    expect(await screen.findByText("You aren't on a team yet.")).toBeInTheDocument()
  })

  it('a failed load shows a fixed message and can be retried', async () => {
    let calls = 0
    signedInAs('admin', {
      routes: {
        'GET /api/teams/': () => {
          calls += 1
          return calls === 1 ? reply(500, { error: { code: 'internal', message: 'raw boom' } }) : reply(200, { teams: [] })
        },
      },
    })
    const { user } = renderApp('/teams')
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument()
    expect(screen.queryByText(/raw boom/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('No teams yet. Create the first one.')).toBeInTheDocument()
  })
})

describe('Team detail', () => {
  it('admin sees members, can add and remove them, and sees the budget', async () => {
    const server = signedInAs('admin')
    const { user } = renderApp('/teams/t-2')

    expect(await screen.findByRole('heading', { name: 'Data' })).toBeInTheDocument()
    expect(screen.getByText('Lead: Mia Manager')).toBeInTheDocument()
    expect(rowFor('Dee Data')).toBeInTheDocument()
    // Admin always gets the numbers, even for a team of one.
    const budget = await screen.findByRole('region', { name: 'Team budget' })
    expect(within(budget).getByText('$70,000.00')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add member' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add a member to Data' })
    await user.click(within(dialog).getByRole('combobox', { name: /person/i }))
    // Only people on no team are offered (Nia, and the unassigned managers/admin).
    expect(screen.getByRole('option', { name: /Nia New/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Eve Employee/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Mia Manager/ })).not.toBeInTheDocument() // the lead
    await user.click(screen.getByRole('option', { name: /Nia New/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Add member' }))

    expect(await screen.findByText('Nia New was added to the team.')).toBeInTheDocument()
    expect(server.calls.find((c) => c.path === '/api/teams/t-2/members').body).toEqual({ employee_id: 'u-8' })
    await waitFor(() => expect(rowFor('Nia New')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Remove Dee Data' }))
    const confirm = await screen.findByRole('dialog', { name: 'Remove Dee Data from Data?' })
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('Dee Data was removed from the team.')).toBeInTheDocument()
    expect(server.count('DELETE', '/api/teams/t-2/members/u-7')).toBe(1)
  })

  it('admin changes the lead; a member cannot be picked', async () => {
    const server = signedInAs('admin')
    const { user } = renderApp('/teams/t-1')
    await screen.findByRole('heading', { name: 'Platform' })
    await user.click(screen.getByRole('button', { name: 'Edit team' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Platform' })
    await choose(user, /lead/i, /Ada Admin/, dialog)
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Platform was updated.')).toBeInTheDocument()
    expect(server.calls.find((c) => c.method === 'PUT').body).toEqual({ lead_id: 'u-1' })
    expect(await screen.findByText('Lead: Ada Admin')).toBeInTheDocument()
  })

  it('saving without changes sends nothing', async () => {
    const server = signedInAs('admin')
    const { user } = renderApp('/teams/t-1')
    await user.click(await screen.findByRole('button', { name: 'Edit team' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Platform' })
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(server.count('PUT', '/api/teams/t-1')).toBe(0)
  })

  it('a rejected member add (on another team) shows the fixed message', async () => {
    signedInAs('admin', {
      routes: { 'POST /api/teams/t-2/members': () => reply(409, { error: { code: 'on_other_team', message: 'raw' } }) },
    })
    const { user } = renderApp('/teams/t-2')
    await user.click(await screen.findByRole('button', { name: 'Add member' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add a member to Data' })
    await user.click(within(dialog).getByRole('button', { name: 'Add member' }))
    expect(within(dialog).getByText('Choose a person.')).toBeInTheDocument()
    await choose(user, /person/i, /Nia New/, dialog)
    await user.click(within(dialog).getByRole('button', { name: 'Add member' }))
    expect(await within(dialog).findByText('That person is on another team. Remove them from it first.'))
      .toBeInTheDocument()
  })

  it('the lead sees their team budget totals but no admin buttons', async () => {
    signedInAs('manager')
    renderApp('/teams/t-1')
    const budget = await screen.findByRole('region', { name: 'Team budget' })
    // Platform has 3 members: Eve 90,000.50 + Bo 83,200 + Cy 72,800.
    expect(within(budget).getByText('$246,000.50')).toBeInTheDocument()
    expect(within(budget).getByText(/Salaries of 3 members/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit team|add member|remove/i })).not.toBeInTheDocument()
  })

  it('a lead of a team below 3 members sees why the totals are hidden, never a number', async () => {
    signedInAs('u-6') // Mia leads Data, which has 1 member
    renderApp('/teams/t-2')
    const budget = await screen.findByRole('region', { name: 'Team budget' })
    expect(within(budget).getByText(/Totals are hidden because fewer than 3 people/)).toBeInTheDocument()
    expect(within(budget).queryByText(/\d,\d{3}\.\d{2}/)).not.toBeInTheDocument()
  })

  it('an employee sees their own team read-only, without the budget', async () => {
    const server = signedInAs('employee')
    renderApp('/teams/t-1')
    await screen.findByRole('heading', { name: 'Platform' })
    expect(rowFor('Bo Builder')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Team budget' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument()
    expect(server.count('GET', '/api/teams/t-1/budget')).toBe(0)
  })

  it('a team the caller cannot see shows a not-found message', async () => {
    signedInAs('employee')
    renderApp('/teams/t-2')
    expect(await screen.findByText("That item doesn't exist or you can't see it.")).toBeInTheDocument()
  })

  it('works as cards on a phone', async () => {
    signedInAs('admin')
    renderApp('/teams/t-1', { width: 400 })
    const list = await screen.findByRole('list', { name: 'Members' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(within(list).getByRole('button', { name: 'Remove Eve Employee' })).toBeInTheDocument()
  })
})
