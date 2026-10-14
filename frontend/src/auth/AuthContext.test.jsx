import { StrictMode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import App from '../App'
import { AuthProvider } from './AuthContext'
import { REFRESH_TOKEN_KEY } from './tokenStorage'
import { useAuth } from './useAuth'
import { ADA, fakeAuthServer, reply } from '../test/fakeAuthServer'

const ME = { ...ADA, job_title: 'Head of Delivery' }

function renderApp(path = '/') {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </StrictMode>,
  )
}

function storeRefreshToken(token) {
  window.localStorage.setItem(REFRESH_TOKEN_KEY, token)
}

describe('session restore on reload', () => {
  it('shows a loading state, then restores the user from the stored refresh token', async () => {
    storeRefreshToken('stored-refresh')
    const server = fakeAuthServer({
      'POST /api/auth/refresh': () => reply(200, { access_token: 'new.access', refresh_token: 'rotated' }),
      'GET /api/auth/me': () => reply(200, ME),
    })
    renderApp('/')

    expect(screen.getByRole('status', { name: /checking your session/i })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Welcome, Ada Admin' })).toBeInTheDocument()

    // StrictMode runs the restore effect twice; still exactly one refresh request.
    expect(server.count('POST', '/api/auth/refresh')).toBe(1)
    expect(server.calls[0].body).toEqual({ refresh_token: 'stored-refresh' })
    // /me used the new in-memory access token; the rotated refresh token was saved.
    expect(server.calls[1].headers.Authorization).toBe('Bearer new.access')
    expect(window.localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('rotated')
    expect(Object.values({ ...window.localStorage })).not.toContain('new.access')
  })

  it('a rejected stored token sends the user to login and forgets the token', async () => {
    storeRefreshToken('revoked-refresh')
    fakeAuthServer({
      'POST /api/auth/refresh': () =>
        reply(401, { error: { code: 'invalid_token', message: 'Invalid refresh token.' } }),
    })
    renderApp('/')

    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument()
    expect(window.localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull()
  })

  it('if the server is unreachable, shows login but keeps the token for a later retry', async () => {
    storeRefreshToken('still-valid-refresh')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    renderApp('/')

    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument()
    expect(window.localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('still-valid-refresh')
  })

  it('with no stored token, a protected page redirects to login without any request', async () => {
    const server = fakeAuthServer({})
    renderApp('/')
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument()
    expect(server.calls).toHaveLength(0)
  })
})

describe('one refresh in flight at a time', () => {
  it('concurrent refreshSession() calls share a single request', async () => {
    storeRefreshToken('stored-refresh')
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const server = fakeAuthServer({
      'POST /api/auth/refresh': async () => {
        await gate // hold the request open while more callers arrive
        return reply(200, { access_token: 'new.access', refresh_token: 'rotated' })
      },
      'GET /api/auth/me': () => reply(200, ME),
    })

    let auth
    function Probe() {
      auth = useAuth()
      return <span>{auth.status}</span>
    }
    render(<AuthProvider><Probe /></AuthProvider>)

    // The mount effect already started one refresh; three more callers join it.
    let results
    await act(async () => {
      const pending = Promise.all([auth.refreshSession(), auth.refreshSession(), auth.refreshSession()])
      release()
      results = await pending
    })

    expect(server.count('POST', '/api/auth/refresh')).toBe(1)
    expect(results).toEqual([ME, ME, ME])
    expect(screen.getByText('authenticated')).toBeInTheDocument()
    expect(auth.getAccessToken()).toBe('new.access')
  })

  it('a later refresh (after the first finished) sends the newly rotated token', async () => {
    storeRefreshToken('first')
    let n = 0
    const server = fakeAuthServer({
      'POST /api/auth/refresh': () => {
        n += 1
        return reply(200, { access_token: `access-${n}`, refresh_token: `rotated-${n}` })
      },
      'GET /api/auth/me': () => reply(200, ME),
    })
    let auth
    function Probe() {
      auth = useAuth()
      return null
    }
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(auth.status).toBe('authenticated'))
    await act(() => auth.refreshSession())

    expect(server.calls.filter((c) => c.path === '/api/auth/refresh').map((c) => c.body.refresh_token))
      .toEqual(['first', 'rotated-1'])
    expect(window.localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('rotated-2')
  })
})

describe('sign out', () => {
  it('revokes the token on the server, clears storage and returns to login', async () => {
    storeRefreshToken('stored-refresh')
    const server = fakeAuthServer({
      'POST /api/auth/refresh': () => reply(200, { access_token: 'new.access', refresh_token: 'rotated' }),
      'GET /api/auth/me': () => reply(200, ME),
      'POST /api/auth/logout': () => reply(204),
    })
    renderApp('/')
    await screen.findByRole('heading', { name: 'Welcome, Ada Admin' })

    await userEvent.setup().click(screen.getByRole('button', { name: /sign out/i }))

    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument()
    expect(window.localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull()
    const logoutCall = server.calls.find((c) => c.path === '/api/auth/logout')
    expect(logoutCall.body).toEqual({ refresh_token: 'rotated' })
  })

  it('still signs out locally when the server is unreachable', async () => {
    storeRefreshToken('stored-refresh')
    fakeAuthServer({
      'POST /api/auth/refresh': () => reply(200, { access_token: 'new.access', refresh_token: 'rotated' }),
      'GET /api/auth/me': () => reply(200, ME),
      'POST /api/auth/logout': () => { throw new TypeError('Failed to fetch') },
    })
    renderApp('/')
    await screen.findByRole('heading', { name: 'Welcome, Ada Admin' })
    await userEvent.setup().click(screen.getByRole('button', { name: /sign out/i }))

    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument()
    expect(window.localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull()
  })
})

describe('useAuth', () => {
  it('throws a clear error outside <AuthProvider>', () => {
    function Orphan() {
      useAuth()
      return null
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Orphan />)).toThrow('useAuth() must be used inside <AuthProvider>')
  })
})
