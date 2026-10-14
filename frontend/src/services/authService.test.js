import { describe, expect, it, vi } from 'vitest'
import { AUTH_URL, AuthError, getMe, login, logout, refresh } from './authService'

/** Replace global fetch with a mock that answers once with (status, JSON body). */
function mockFetch(status, body, { invalidJson = false } = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (invalidJson) throw new SyntaxError('Unexpected token <')
      return body
    },
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function lastCall(fetchMock) {
  const [url, init] = fetchMock.mock.calls.at(-1)
  return { url, init, body: init.body === undefined ? undefined : JSON.parse(init.body) }
}

describe('authService', () => {
  it('talks to the local auth service by default', () => {
    expect(AUTH_URL).toBe('http://localhost:3001/api/auth')
  })

  it('login POSTs email and password as JSON and returns the response', async () => {
    const reply = {
      access_token: 'a.b.c',
      refresh_token: 'opaque',
      user: { id: '1', email: 'ada@acme.test', name: 'Ada', role: 'admin' },
    }
    const fetchMock = mockFetch(200, reply)

    await expect(login('ada@acme.test', 'pw-123')).resolves.toEqual(reply)

    const { url, init, body } = lastCall(fetchMock)
    expect(url).toBe(`${AUTH_URL}/login`)
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.headers.Authorization).toBeUndefined()
    expect(body).toEqual({ email: 'ada@acme.test', password: 'pw-123' })
  })

  it('login with a wrong password rejects with AuthError 401 invalid_credentials', async () => {
    mockFetch(401, { error: { code: 'invalid_credentials', message: 'raw server text' } })

    const error = await login('ada@acme.test', 'wrong').catch((e) => e)
    expect(error).toBeInstanceOf(AuthError)
    expect(error.status).toBe(401)
    expect(error.code).toBe('invalid_credentials')
    expect(error.message).not.toContain('raw server text')
  })

  it('refresh POSTs the refresh token', async () => {
    const fetchMock = mockFetch(200, { access_token: 'new.access', refresh_token: 'new-opaque' })

    await expect(refresh('old-opaque')).resolves.toEqual({
      access_token: 'new.access',
      refresh_token: 'new-opaque',
    })
    const { url, init, body } = lastCall(fetchMock)
    expect(url).toBe(`${AUTH_URL}/refresh`)
    expect(init.method).toBe('POST')
    expect(body).toEqual({ refresh_token: 'old-opaque' })
  })

  it('logout POSTs the refresh token and resolves to null on 204', async () => {
    const fetchMock = mockFetch(204)

    await expect(logout('opaque')).resolves.toBeNull()
    const { url, body } = lastCall(fetchMock)
    expect(url).toBe(`${AUTH_URL}/logout`)
    expect(body).toEqual({ refresh_token: 'opaque' })
  })

  it('getMe sends a GET with the Bearer access token and no body', async () => {
    const me = { id: '1', email: 'ada@acme.test', name: 'Ada', role: 'admin', job_title: 'Lead' }
    const fetchMock = mockFetch(200, me)

    await expect(getMe('a.b.c')).resolves.toEqual(me)
    const { url, init } = lastCall(fetchMock)
    expect(url).toBe(`${AUTH_URL}/me`)
    expect(init.method).toBe('GET')
    expect(init.headers.Authorization).toBe('Bearer a.b.c')
    expect(init.headers['Content-Type']).toBeUndefined()
    expect(init.body).toBeUndefined()
  })

  it('an expired access token surfaces as AuthError token_expired', async () => {
    mockFetch(401, { error: { code: 'token_expired', message: 'Token has expired.' } })
    await expect(getMe('old.token')).rejects.toMatchObject({ status: 401, code: 'token_expired' })
  })

  it('a network failure becomes AuthError status 0 network_error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(login('a@b.c', 'x')).rejects.toMatchObject({ status: 0, code: 'network_error' })
  })

  it('a non-JSON error page becomes AuthError unknown_error', async () => {
    mockFetch(502, null, { invalidJson: true })
    await expect(refresh('opaque')).rejects.toMatchObject({ status: 502, code: 'unknown_error' })
  })
})
