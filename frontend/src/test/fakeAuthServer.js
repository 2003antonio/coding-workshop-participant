// Test helper: a fake auth server behind a mocked global fetch.
//   const server = fakeAuthServer({ 'POST /login': () => reply(200, {...}) })
//   server.calls -> [{ method, path, query, body, headers }, ...]
import { vi } from 'vitest'

export function reply(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

export const ADA = { id: 'u-1', email: 'ada@acme.test', name: 'Ada Admin', role: 'admin' }

export function fakeAuthServer(handlers) {
  const calls = []
  const fetchMock = vi.fn(async (url, init = {}) => {
    const method = init.method ?? 'GET'
    const { pathname: path, search: query } = new URL(url)
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ method, path, query, body, headers: init.headers ?? {} })
    const handler = handlers[`${method} ${path}`]
    if (!handler) return reply(404, { error: { code: 'not_found', message: 'Unknown route.' } })
    return handler(body, init)
  })
  vi.stubGlobal('fetch', fetchMock)
  return {
    calls,
    count: (method, path) => calls.filter((c) => c.method === method && c.path === path).length,
  }
}
