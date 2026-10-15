import { describe, expect, it, vi } from 'vitest'
import { API_URL } from './apiClient'
import { listProjects } from './projectService'

/** A fake fetch that answers 200 with an empty project list. */
function mockFetch() {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ projects: [] }) })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
const urlOf = (fetchMock) => fetchMock.mock.calls.at(-1)[0]

describe('listProjects search (q)', () => {
  it('sends q, trimmed and URL-encoded', async () => {
    const fetchMock = mockFetch()
    await listProjects('t', { q: '  billing & co  ' })
    expect(urlOf(fetchMock)).toBe(`${API_URL}/projects/?q=billing+%26+co`)
  })

  it('sends no q when the text is blank or missing', async () => {
    const fetchMock = mockFetch()
    await listProjects('t', { q: '   ' })
    expect(urlOf(fetchMock)).toBe(`${API_URL}/projects/`)
    await listProjects('t', { q: '' })
    expect(urlOf(fetchMock)).toBe(`${API_URL}/projects/`)
    await listProjects('t')
    expect(urlOf(fetchMock)).toBe(`${API_URL}/projects/`)
  })

  it('combines q with the other filters', async () => {
    const fetchMock = mockFetch()
    await listProjects('t', { teamId: 't-1', status: 'active', q: 'lake', includeArchived: true })
    expect(urlOf(fetchMock)).toBe(`${API_URL}/projects/?team_id=t-1&status=active&q=lake&include_archived=true`)
  })
})
