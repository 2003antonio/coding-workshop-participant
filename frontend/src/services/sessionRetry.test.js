import { describe, expect, it, vi } from 'vitest'
import { withSessionRetry } from './sessionRetry'

const unauthorized = () => Object.assign(new Error('401'), { status: 401 })

/** A fake session: tokens 'token-1', 'token-2', ... each refresh moves to the next. */
function fakeSession({ refreshFails = false } = {}) {
  let current = 1
  return {
    getAccessToken: () => `token-${current}`,
    refreshSession: vi.fn(async () => {
      if (refreshFails) throw unauthorized()
      current += 1
    }),
  }
}

describe('withSessionRetry', () => {
  it('returns the result without refreshing when the call succeeds', async () => {
    const session = fakeSession()
    const call = vi.fn().mockResolvedValue('rows')

    await expect(withSessionRetry(call, session)).resolves.toBe('rows')
    expect(call).toHaveBeenCalledTimes(1)
    expect(call).toHaveBeenCalledWith('token-1')
    expect(session.refreshSession).not.toHaveBeenCalled()
  })

  it('after a 401 refreshes once and retries once with the new token', async () => {
    const session = fakeSession()
    const call = vi.fn().mockRejectedValueOnce(unauthorized()).mockResolvedValueOnce('rows')

    await expect(withSessionRetry(call, session)).resolves.toBe('rows')
    expect(session.refreshSession).toHaveBeenCalledTimes(1)
    expect(call.mock.calls).toEqual([['token-1'], ['token-2']])
  })

  it('a second 401 is thrown, never retried again (no loop)', async () => {
    const session = fakeSession()
    const second = unauthorized()
    const call = vi.fn().mockRejectedValueOnce(unauthorized()).mockRejectedValueOnce(second)

    await expect(withSessionRetry(call, session)).rejects.toBe(second)
    expect(call).toHaveBeenCalledTimes(2)
    expect(session.refreshSession).toHaveBeenCalledTimes(1)
  })

  it('if the refresh fails, its error is thrown and the call is not retried', async () => {
    const session = fakeSession({ refreshFails: true })
    const call = vi.fn().mockRejectedValue(unauthorized())

    await expect(withSessionRetry(call, session)).rejects.toMatchObject({ status: 401 })
    expect(call).toHaveBeenCalledTimes(1)
  })

  it.each([[403], [404], [409], [500], [0]])('a %s error is thrown without refreshing', async (status) => {
    const session = fakeSession()
    const call = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { status }))

    await expect(withSessionRetry(call, session)).rejects.toMatchObject({ status })
    expect(call).toHaveBeenCalledTimes(1)
    expect(session.refreshSession).not.toHaveBeenCalled()
  })
})
