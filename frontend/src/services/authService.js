// The only module that calls fetch() for authentication. It sends requests to
// the auth service and returns parsed JSON; it never stores tokens itself.
//
// Paths match backend/auth/routes.py. Locally they are served by
// scripts/dev_server.py on port 3001; in AWS, CloudFront routes /api/auth/*.

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/+$/, '')
export const AUTH_URL = `${API_BASE}/api/auth`

/** A failed auth request: HTTP status (0 = network failure) and the server's error code. */
export class AuthError extends Error {
  constructor(status, code) {
    super(`Auth request failed (${status} ${code})`)
    this.name = 'AuthError'
    this.status = status
    this.code = code
  }
}

async function request(path, { method = 'POST', body, accessToken } = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  let response
  try {
    response = await fetch(`${AUTH_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new AuthError(0, 'network_error')
  }

  if (response.status === 204) return null

  let data
  try {
    data = await response.json()
  } catch {
    data = null
  }
  if (!response.ok) {
    throw new AuthError(response.status, data?.error?.code ?? 'unknown_error')
  }
  return data
}

/** POST /login -> { access_token, refresh_token, user: { id, email, name, role } } */
export function login(email, password) {
  return request('/login', { body: { email, password } })
}

/** POST /refresh -> { access_token, refresh_token } (the old refresh token is now used up) */
export function refresh(refreshToken) {
  return request('/refresh', { body: { refresh_token: refreshToken } })
}

/** POST /logout -> null (204). Revokes the refresh token on the server. */
export function logout(refreshToken) {
  return request('/logout', { body: { refresh_token: refreshToken } })
}

/** GET /me -> { id, email, name, role, job_title } */
export function getMe(accessToken) {
  return request('/me', { method: 'GET', accessToken })
}
