// The only module that calls fetch() for employees. Every function takes the
// access token as its first argument and returns parsed JSON; it never reads or
// stores tokens itself. Wrap calls in withSessionRetry() (sessionRetry.js) so an
// expired access token is refreshed once and the call retried.
//
// Paths match backend/employees/routes.py. Locally they are served by
// scripts/dev_server.py on port 3001; in AWS, CloudFront routes /api/employees/*.

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/+$/, '')
export const EMPLOYEES_URL = `${API_BASE}/api/employees`

/** A failed employees request: HTTP status (0 = network failure) and the server's error code. */
export class EmployeeApiError extends Error {
  constructor(status, code) {
    super(`Employees request failed (${status} ${code})`)
    this.name = 'EmployeeApiError'
    this.status = status
    this.code = code
  }
}

async function request(path, accessToken, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  let response
  try {
    response = await fetch(`${EMPLOYEES_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new EmployeeApiError(0, 'network_error')
  }

  let data
  try {
    data = await response.json()
  } catch {
    data = null
  }
  if (!response.ok) {
    throw new EmployeeApiError(response.status, data?.error?.code ?? 'unknown_error')
  }
  return data
}

const one = (id) => `/${encodeURIComponent(id)}`

/** GET / -> [{ id, name, email, job_title, role }]; admins also get salary and archived_at */
export async function listEmployees(accessToken, { includeArchived = false } = {}) {
  const query = includeArchived ? '?include_archived=true' : ''
  const data = await request(`/${query}`, accessToken)
  return data.employees
}

/** GET /{id} -> one employee */
export function getEmployee(accessToken, id) {
  return request(one(id), accessToken)
}

/** POST / (admin) -> the created employee. fields: name, email, job_title, role, salary, password */
export function createEmployee(accessToken, fields) {
  return request('/', accessToken, { method: 'POST', body: fields })
}

/** PUT /{id} (admin) -> the updated employee. changes: any of name, job_title, role, salary */
export function updateEmployee(accessToken, id, changes) {
  return request(one(id), accessToken, { method: 'PUT', body: changes })
}

/** POST /{id}/archive (admin) -> the archived employee */
export function archiveEmployee(accessToken, id) {
  return request(`${one(id)}/archive`, accessToken, { method: 'POST' })
}
