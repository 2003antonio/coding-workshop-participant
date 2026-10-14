import { useCallback, useEffect, useState } from 'react'
import { withSessionRetry } from '../services/sessionRetry'
import { messageFor } from '../pages/apiMessages'
import { useAuth } from './useAuth'

/**
 * Returns api(call): runs call(accessToken) with the 401 retry from sessionRetry.js.
 *   const api = useApi()
 *   const teams = await api((token) => teamService.listTeams(token))
 */
export function useApi() {
  const { getAccessToken, refreshSession } = useAuth()
  return useCallback(
    (call) => withSessionRetry(call, { getAccessToken, refreshSession }),
    [getAccessToken, refreshSession],
  )
}

/**
 * Load data for a page. `load(api)` must be memoised (useCallback): a new
 * function means "load again". While reloading, the last data stays on screen.
 *   const { status, data, error, reload } = useLoad(load)
 * status: 'loading' (nothing to show yet) | 'error' | 'ready'.
 * error is a friendly fixed message, never the server's text.
 */
export function useLoad(load) {
  const api = useApi()
  const [reloads, setReloads] = useState(0)
  const [result, setResult] = useState({ load: null, reloads: -1, data: undefined, error: '' })

  useEffect(() => {
    let cancelled = false
    load(api).then(
      (data) => { if (!cancelled) setResult({ load, reloads, data, error: '' }) },
      (error) => { if (!cancelled) setResult({ load, reloads, data: undefined, error: messageFor(error) }) },
    )
    return () => {
      cancelled = true
    }
  }, [api, load, reloads])

  const current = result.load === load && result.reloads === reloads
  let status = 'ready'
  if (current && result.error) status = 'error'
  else if (!current && result.data === undefined) status = 'loading'
  const reload = useCallback(() => setReloads((n) => n + 1), [])
  return { status, data: result.data, error: current ? result.error : '', reload }
}
