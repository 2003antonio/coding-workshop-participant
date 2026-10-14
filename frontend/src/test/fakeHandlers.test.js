import { describe, expect, it, vi } from 'vitest'
import { reply } from './fakeAuthServer'
import { signedInAs } from './fakeApiServer'

// A plug-in route, as a lane would add in fakeHandlers/<topic>.js.
vi.mock('./fakeHandlers', () => ({
  extraRoutes: [['GET', /^\/api\/ping\/(?<id>[^/]+)$/, ({ params, me, today, db }) =>
    reply(200, { id: params.id, who: me().name, today, teams: db.teams.length })]],
}))

describe('fakeHandlers plug-in routes', () => {
  it('are served after the core routes, with the data, the user and today', async () => {
    signedInAs('manager')
    const response = await fetch('http://localhost:3001/api/ping/42')
    expect(await response.json()).toEqual({ id: '42', who: 'Max Manager', today: '2026-11-10', teams: expect.any(Number) })
  })

  it('cannot shadow a core route', async () => {
    signedInAs('employee')
    const response = await fetch('http://localhost:3001/api/employees/')
    expect(response.status).toBe(403)
  })
})
