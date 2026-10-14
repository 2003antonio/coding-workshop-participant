// The one fetch() wrapper behind the teams, projects, allocations, budget and
// report services (docs/api-contract.md). Each function takes the access token
// and returns parsed JSON; it never reads or stores tokens itself. Wrap calls in
// withSessionRetry() (sessionRetry.js) so an expired access token is refreshed
// once and the call retried.
//
// Locally the API is served on port 3001; in AWS, CloudFront routes /api/*.

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/+$/, '')
export const API_URL = `${API_BASE}/api`

/**
 * A failed request: HTTP status (0 = network failure), the server's error code
 * and, for a few 409s, its structured `details` (e.g. the weeks over 40 hours).
 * The server's message text is dropped on purpose: pages show fixed messages.
 */
export class ApiError extends Error {
  constructor(status, code, details = null) {
    super(`API request failed (${status} ${code})`)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

/** Build "?a=1&b=2" from the set values only (undefined, null, '' and false are left out). */
export function toQuery(params = {}) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue
    search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

/** URL-safe path segment for an id. */
export const seg = (id) => encodeURIComponent(id)

/** request('/teams/', token, { method, body }) -> parsed JSON, or throws ApiError. */
export async function request(path, accessToken, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  let response
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'network_error')
  }

  let data
  try {
    data = await response.json()
  } catch {
    data = null
  }
  if (!response.ok) {
    const details = data?.error?.details
    throw new ApiError(
      response.status,
      data?.error?.code ?? 'unknown_error',
      details && typeof details === 'object' ? details : null,
    )
  }
  return data
}
