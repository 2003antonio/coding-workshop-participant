import { describe, expect, it, vi } from 'vitest'
import {
  EMPLOYEES_URL,
  EmployeeApiError,
  archiveEmployee,
  createEmployee,
  getEmployee,
  listEmployees,
  updateEmployee,
} from './employeeService'

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

const EVE = { id: 'e-3', name: 'Eve Employee', email: 'eve@acme.test', job_title: 'Engineer', role: 'employee' }

describe('employeeService', () => {
  it('talks to the local employees service by default', () => {
    expect(EMPLOYEES_URL).toBe('http://localhost:3001/api/employees')
  })

  it('listEmployees GETs the list with the bearer token and returns the rows', async () => {
    const fetchMock = mockFetch(200, { employees: [EVE] })

    await expect(listEmployees('access.jwt')).resolves.toEqual([EVE])

    const { url, init, body } = lastCall(fetchMock)
    expect(url).toBe(`${EMPLOYEES_URL}/`)
    expect(init.method).toBe('GET')
    expect(init.headers.Authorization).toBe('Bearer access.jwt')
    expect(init.headers['Content-Type']).toBeUndefined()
    expect(body).toBeUndefined()
  })

  it('listEmployees asks for archived employees only when told to', async () => {
    const fetchMock = mockFetch(200, { employees: [] })
    await listEmployees('t', { includeArchived: true })
    expect(lastCall(fetchMock).url).toBe(`${EMPLOYEES_URL}/?include_archived=true`)
  })

  it('getEmployee GETs one employee and encodes the id', async () => {
    const fetchMock = mockFetch(200, EVE)
    await expect(getEmployee('t', 'a/b?c')).resolves.toEqual(EVE)
    expect(lastCall(fetchMock).url).toBe(`${EMPLOYEES_URL}/a%2Fb%3Fc`)
  })

  it('createEmployee POSTs the fields as JSON', async () => {
    const fields = { ...EVE, salary: 90000, password: 'Initial-Pass-2024' }
    const fetchMock = mockFetch(201, { ...EVE, salary: 90000 })

    await createEmployee('t', fields)

    const { url, init, body } = lastCall(fetchMock)
    expect(url).toBe(`${EMPLOYEES_URL}/`)
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(body).toEqual(fields)
  })

  it('updateEmployee PUTs the changes to /{id}', async () => {
    const fetchMock = mockFetch(200, EVE)
    await updateEmployee('t', 'e-3', { job_title: 'Senior Engineer' })
    const { url, init, body } = lastCall(fetchMock)
    expect(url).toBe(`${EMPLOYEES_URL}/e-3`)
    expect(init.method).toBe('PUT')
    expect(body).toEqual({ job_title: 'Senior Engineer' })
  })

  it('archiveEmployee POSTs to /{id}/archive with no body', async () => {
    const fetchMock = mockFetch(200, EVE)
    await archiveEmployee('t', 'e-3')
    const { url, init, body } = lastCall(fetchMock)
    expect(url).toBe(`${EMPLOYEES_URL}/e-3/archive`)
    expect(init.method).toBe('POST')
    expect(body).toBeUndefined()
  })

  it('an error response rejects with status and code, never the server message', async () => {
    mockFetch(409, { error: { code: 'email_taken', message: 'raw server text' } })

    const error = await createEmployee('t', {}).catch((e) => e)
    expect(error).toBeInstanceOf(EmployeeApiError)
    expect(error.status).toBe(409)
    expect(error.code).toBe('email_taken')
    expect(error.message).not.toContain('raw server text')
  })

  it('an error without a JSON body still rejects with its status', async () => {
    mockFetch(502, null, { invalidJson: true })
    await expect(listEmployees('t')).rejects.toMatchObject({ status: 502, code: 'unknown_error' })
  })

  it('a network failure rejects with status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(listEmployees('t')).rejects.toMatchObject({ status: 0, code: 'network_error' })
  })
})
