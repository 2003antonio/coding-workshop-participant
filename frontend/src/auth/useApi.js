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
 * function means "load something else" and shows 'loading' until it answers.
 * reload() loads the same thing again; meanwhile the last data stays on screen
 * and `updating` is true. A changed `refreshKey` (e.g. from useProjectRefresh)
 * is a reload too, so one counter can refresh several loads at once.
 *   const { status, data, error, reload, updating } = useLoad(load, refreshKey)
 * status: 'loading' (nothing to show yet) | 'error' | 'ready'.
 * error is a friendly fixed message, never the server's text.
 */
export function useLoad(load, refreshKey = 0) {
  const api = useApi()
  const [ownReloads, setReloads] = useState(0)
  const reloads = ownReloads + refreshKey
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

  // A new load function means new data: the last result (even a null one) is
  // never shown as its answer. Only a reload of the same load keeps old data.
  const sameLoad = result.load === load
  const current = sameLoad && result.reloads === reloads
  let status = 'ready'
  if (current && result.error) status = 'error'
  else if (!sameLoad || (!current && result.data === undefined)) status = 'loading'
  const reload = useCallback(() => setReloads((n) => n + 1), [])
  const updating = sameLoad && !current && result.data !== undefined
  return { status, data: sameLoad ? result.data : undefined, error: current ? result.error : '', reload, updating }
}
