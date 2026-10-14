import { act, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { reply, signedInAs } from '../test/fakeApiServer'
import { choose, headersOf, renderApp } from '../test/renderApp'

const CHAIN = {
  project: { id: 'p-1', name: 'Billing v2' },
  nodes: [{ id: 'd-1', name: 'API spec', status: 'done', due_date: '2026-11-20', depth: 0 }],
  edges: [],
  order: ['d-1'],
  longest_chain: ['d-1'],
}

/** A dependency-chain route that answers only when the test calls release(). */
function heldChain() {
  const waiting = []
  return {
    route: () => new Promise((resolve) => waiting.push(resolve)),
    release: () => act(async () => waiting.splice(0).forEach((resolve) => resolve(reply(200, CHAIN)))),
  }
}

describe('Dependencies report (ChainReport)', () => {
  it('asks for a project, shows a skeleton while the chain loads, never a blank, then the chain', async () => {
    const held = heldChain()
    signedInAs('manager', { routes: { 'GET /api/reports/dependency-chain': held.route } })
    const { user } = renderApp('/reports?report=chain')
    expect(await screen.findByText('Choose a project to see its dependency chain.')).toBeInTheDocument()

    await choose(user, 'Project', 'Billing v2')
    const status = await screen.findByRole('status', { name: 'Loading dependency chain' })
    expect(status).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText('Choose a project to see its dependency chain.')).not.toBeInTheDocument()

    await held.release()
    expect(await screen.findByText('Longest chain:')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: /^Loading/ })).not.toBeInTheDocument()
  })

  it('picking another project shows the skeleton again, not the old chain', async () => {
    const held = heldChain()
    signedInAs('admin', { routes: { 'GET /api/reports/dependency-chain': held.route } })
    const { user } = renderApp('/reports?report=chain')
    await screen.findByText('Choose a project to see its dependency chain.')
    await choose(user, 'Project', 'Billing v2')
    await held.release()
    await screen.findByText('Longest chain:')

    await choose(user, 'Project', 'Data Lake')
    expect(await screen.findByRole('status', { name: 'Loading dependency chain' })).toBeInTheDocument()
    expect(screen.queryByText('Longest chain:')).not.toBeInTheDocument()
  })
})

describe('Resources report: week columns carry the year', () => {
  it('a run of weeks across New Year shows 2026 and 2027', async () => {
    signedInAs('admin', { today: '2026-12-30' })
    renderApp('/reports?report=resources')
    await screen.findByRole('table', { name: 'Resource allocation' })
    const weeks = headersOf('Resource allocation').slice(1)
    expect(weeks.slice(0, 2)).toEqual(['Dec 28 ’26', 'Jan 4 ’27'])
    expect(screen.getByText(/from the week of Dec 28, 2026\./)).toBeInTheDocument()
  })
})
