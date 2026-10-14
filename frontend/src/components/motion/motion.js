// The one place that decides whether and how things move. Everything that
// animates asks motionSx() (or useMotion()) for its sx, so "reduce motion" in
// the computer's settings turns every animation off here: no animation props
// at all, not just shorter ones. Each animation stays under 300 ms in total.
import { useCallback, useSyncExternalStore } from 'react'
import { keyframes } from '@mui/material/styles'

const QUERY = '(prefers-reduced-motion: reduce)'

function subscribe(onChange) {
  const media = window.matchMedia?.(QUERY)
  media?.addEventListener?.('change', onChange)
  return () => media?.removeEventListener?.('change', onChange)
}
const reducedNow = () => Boolean(window.matchMedia?.(QUERY)?.matches)

/** true when the computer asks for reduced motion; follows changes live. */
export function usePrefersReducedMotion() {
  return useSyncExternalStore(subscribe, reducedNow, () => false)
}

const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
`
const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`
const growX = keyframes`
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
`

/** Durations in ms. A list staggers its first few items, then the rest arrive together. */
export const MOTION = { duration: 200, stagger: 25, maxStaggered: 4 }

const KINDS = {
  enter: { frames: fadeUp }, // pages, cards: fade in and rise 6 px
  fade: { frames: fadeIn }, // table rows: fade only
  grow: { frames: growX, sx: { transformOrigin: 'left center' } }, // bars grow from their start
}

/**
 * sx for an entrance animation of `kind` ('enter' | 'fade' | 'grow'), the
 * index-th item of a list (for the stagger). {} when motion is reduced.
 */
export function motionSx(reduced, kind = 'enter', index = 0) {
  if (reduced) return {}
  const { frames, sx } = KINDS[kind] ?? KINDS.enter
  const delay = Math.min(Math.max(index, 0), MOTION.maxStaggered) * MOTION.stagger
  return { ...sx, animation: `${frames} ${MOTION.duration}ms ease-out ${delay}ms both` }
}

/** const motion = useMotion(); <Box sx={motion('grow', i)} /> */
export function useMotion() {
  const reduced = usePrefersReducedMotion()
  return useCallback((kind, index) => motionSx(reduced, kind, index), [reduced])
}
