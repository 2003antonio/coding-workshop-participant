import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import App from '../App'
import { REFRESH_TOKEN_KEY } from '../auth/tokenStorage'
import { ADA, fakeAuthServer, reply } from '../test/fakeAuthServer'

const GENERIC = 'Invalid email or password.'

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

async function signIn(email, password) {
  const user = userEvent.setup()
  if (email) await user.type(screen.getByLabelText(/email/i), email)
  if (password) await user.type(screen.getByLabelText(/password/i), password)
  await user.click(screen.getByRole('button', { name: /sign in/i }))
}

describe('LoginPage', () => {
  it('wrong password shows the generic message, never the raw server text', async () => {
    const server = fakeAuthServer({
      'POST /api/auth/login': () =>
        reply(401, { error: { code: 'invalid_credentials', message: 'raw server text: row 42' } }),
    })
    renderAt('/login')

    await signIn('ada@acme.test', 'wrong-password')

    expect(await screen.findByText(GENERIC)).toBeInTheDocument()
    expect(screen.queryByText(/raw server text/)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument()
    expect(server.count('POST', '/api/auth/login')).toBe(1)
    expect(window.localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull()
  })

  it.each([
    ['invalid_credentials'],
    ['token_expired'],
    ['some_future_code'],
  ])('every 401 (%s) shows the same generic message', async (code) => {
    fakeAuthServer({
      'POST /api/auth/login': () => reply(401, { error: { code, message: `server says ${code}` } }),
    })
    renderAt('/login')
    await signIn('ada@acme.test', 'whatever')
    expect(await screen.findByText(GENERIC)).toBeInTheDocument()
    expect(screen.queryByText(/server says/)).not.toBeInTheDocument()
  })

  it('right password navigates away to the home page', async () => {
    const server = fakeAuthServer({
      'POST /api/auth/login': () =>
        reply(200, { access_token: 'access.jwt.value', refresh_token: 'opaque-refresh', user: ADA }),
    })
    renderAt('/login')

    await signIn('ada@acme.test', 'Right-Pass-1')

    expect(await screen.findByRole('heading', { name: 'Welcome, Ada Admin' })).toBeInTheDocument()
    expect(screen.getByText('Admin')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument()
    expect(server.calls[0].body).toEqual({ email: 'ada@acme.test', password: 'Right-Pass-1' })
    // Only the refresh token is persisted; the access token stays in memory.
    expect(window.localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('opaque-refresh')
    expect(Object.values({ ...window.localStorage })).not.toContain('access.jwt.value')
  })

  it('empty fields show a hint without calling the server', async () => {
    const server = fakeAuthServer({})
    renderAt('/login')
    await signIn('', '')
    expect(await screen.findByText('Enter your email and password.')).toBeInTheDocument()
    expect(server.calls).toHaveLength(0)
  })

  it('a server it cannot reach shows a friendly network message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    renderAt('/login')
    await signIn('ada@acme.test', 'pw')
    expect(await screen.findByText("Can't reach the server. Please try again.")).toBeInTheDocument()
  })

  it('a server crash shows a generic message, not the server error', async () => {
    fakeAuthServer({
      'POST /api/auth/login': () =>
        reply(500, { error: { code: 'internal_error', message: 'Internal server error.' } }),
    })
    renderAt('/login')
    await signIn('ada@acme.test', 'pw')
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument()
    expect(screen.queryByText('Internal server error.')).not.toBeInTheDocument()
  })
})
