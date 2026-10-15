// How long ago something happened, in words, and the exact time for a tooltip.

const relative = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' })
const exact = new Intl.DateTimeFormat('en-US', {
  weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
})

const STEPS = [
  ['year', 365 * 24 * 3600], ['month', 30 * 24 * 3600], ['week', 7 * 24 * 3600],
  ['day', 24 * 3600], ['hour', 3600], ['minute', 60],
]

/** "just now", "5 minutes ago", "yesterday", "3 days ago" (an ISO time against `now`). */
export function timeAgo(iso, now = Date.now()) {
  const seconds = Math.round((Date.parse(iso) - now) / 1000)
  if (Math.abs(seconds) < 45) return 'just now'
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit)
  }
  return relative.format(Math.round(seconds / 60), 'minute')
}

/** "Wed, Oct 14, 2026, 9:46 AM" in this computer's time zone. */
export const exactTime = (iso) => exact.format(new Date(iso))

/**
 * Consecutive rows that say exactly the same thing (e.g. six failed sign-ins in a row)
 * become one row with `times`, keeping the newest row's time. Nothing is dropped.
 */
export function groupRepeats(rows) {
  const groups = []
  for (const row of rows) {
    const last = groups.at(-1)
    if (last && last.sentence === row.sentence && last.type === row.type) last.times += 1
    else groups.push({ ...row, times: 1 })
  }
  return groups
}
