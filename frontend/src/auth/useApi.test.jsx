import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AuthContext } from './useAuth'
import { useLoad } from './useApi'

// useLoad only needs the token helpers from the session.
const session = { getAccessToken: async () => 'token', refreshSession: async () => 'token' }
const wrapper = ({ children }) => <AuthContext.Provider value={session}>{children}</AuthContext.Provider>

/** A load function whose result arrives only when the test says so. */
function deferredLoad() {
  let settle
  const load = () => new Promise((resolve, reject) => { settle = { resolve, reject } })
  return { load, resolve: (value) => act(async () => settle.resolve(value)), reject: (e) => act(async () => settle.reject(e)) }
}

const renderLoad = (load) => renderHook(({ load: current }) => useLoad(current), { wrapper, initialProps: { load } })

describe('useLoad', () => {
  it('starts loading, then is ready with the data', async () => {
    const first = deferredLoad()
    const { result } = renderLoad(first.load)
    expect(result.current.status).toBe('loading')
    await first.resolve({ rows: [1] })
    expect(result.current).toMatchObject({ status: 'ready', data: { rows: [1] }, error: '' })
  })

  it('a NEW load function never shows the previous result as current, even a null one', async () => {
    // ChainReport: "no project picked" resolves to null; picking a project is a new load.
    const nothing = deferredLoad()
    const { result, rerender } = renderLoad(nothing.load)
    await nothing.resolve(null)
    expect(result.current).toMatchObject({ status: 'ready', data: null })

    const chain = deferredLoad()
    rerender({ load: chain.load })
    expect(result.current.status).toBe('loading')
    expect(result.current.data).toBeUndefined()

    await chain.resolve({ nodes: ['a'] })
    expect(result.current).toMatchObject({ status: 'ready', data: { nodes: ['a'] } })

    const other = deferredLoad()
    rerender({ load: other.load })
    expect(result.current).toMatchObject({ status: 'loading', data: undefined })
  })

  it('a reload of the same load keeps the old data on screen until the new data arrives', async () => {
    let calls = 0
    const load = () => Promise.resolve({ call: ++calls })
    const { result } = renderLoad(load)
    await waitFor(() => expect(result.current.data).toEqual({ call: 1 }))
    act(() => result.current.reload())
    expect(result.current).toMatchObject({ status: 'ready', data: { call: 1 } })
    await waitFor(() => expect(result.current.data).toEqual({ call: 2 }))
  })

  it('an error gives a friendly fixed message, and "Try again" loads again', async () => {
    const failing = deferredLoad()
    const { result } = renderLoad(failing.load)
    await failing.reject(new Error('raw server text'))
    expect(result.current.status).toBe('error')
    expect(result.current.error).not.toMatch(/raw server text/)
    act(() => result.current.reload())
    expect(result.current.status).toBe('loading')
  })
})
