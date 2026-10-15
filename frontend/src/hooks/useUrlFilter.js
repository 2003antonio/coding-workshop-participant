import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * A list filter kept in the page address (?status=active), so a link can open a
 * list already filtered (Home's cards do), and Back, refresh or a shared link keep it.
 *   const [status, setStatus] = useUrlFilter('status', Object.keys(PROJECT_STATUS))
 * A value `allowed` does not accept reads as '' (no filter); `allowed` is a list, or a
 * function for open-ended values such as ids. Setting '' removes the parameter.
 * Other parameters (?tab=, ?report=) are kept, and the history entry is replaced, so
 * Back leaves the page rather than undoing a filter.
 */
export function useUrlFilter(name, allowed) {
  const [params, setParams] = useSearchParams()
  const raw = params.get(name) ?? ''
  const ok = typeof allowed === 'function' ? allowed(raw) : allowed.includes(raw)
  const set = useCallback((next) => {
    setParams((current) => {
      const updated = new URLSearchParams(current)
      if (next) updated.set(name, next)
      else updated.delete(name)
      return updated
    }, { replace: true })
  }, [name, setParams])
  return [raw && ok ? raw : '', set]
}

/** Any non-empty value, for filters on ids (a team id; a stale one simply matches nothing). */
export const anyValue = (value) => value !== ''

/** An on/off filter in the address: ?name=1 is on, anything else is off. */
export function useUrlFlag(name) {
  const [value, set] = useUrlFilter(name, ['1'])
  const setFlag = useCallback((on) => set(on ? '1' : ''), [set])
  return [value === '1', setFlag]
}
