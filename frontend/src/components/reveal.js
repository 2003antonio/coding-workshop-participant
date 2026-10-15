// Timing and mask text for MaskedMoney (click-to-reveal of an individual's pay).
import { useCallback, useEffect, useRef, useState } from 'react'

/** A revealed figure masks itself again after this long. */
export const REVEAL_MS = 30000
/** What a masked figure shows instead (no digits, same width for every person). */
export const MASK = '$ ••••••'

/** Shown or hidden, in memory only, with a timer that hides it again after REVEAL_MS. */
export function useReveal() {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!shown) return undefined
    const timer = setTimeout(() => setShown(false), REVEAL_MS)
    return () => clearTimeout(timer)
  }, [shown])
  return [shown, setShown]
}

/**
 * The same for many rows at once (a table): isShown(id), toggle(id). Each row
 * hides itself again after REVEAL_MS; all timers stop when the table unmounts.
 */
export function useRevealSet() {
  const [shown, setShown] = useState(() => new Set())
  const timers = useRef(new Map())
  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((timer) => clearTimeout(timer))
  }, [])
  const set = useCallback((id, on) => setShown((was) => {
    const next = new Set(was)
    if (on) next.add(id)
    else next.delete(id)
    return next
  }), [])
  const toggle = useCallback((id) => {
    const on = !shown.has(id)
    clearTimeout(timers.current.get(id))
    if (on) timers.current.set(id, setTimeout(() => set(id, false), REVEAL_MS))
    set(id, on)
  }, [shown, set])
  return { isShown: (id) => shown.has(id), toggle }
}
