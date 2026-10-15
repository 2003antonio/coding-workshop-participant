// Which deliverables "Coming up" lists (components/ComingUp/ComingUp.jsx).
// Dates are calendar days compared with today on this computer (local time).
import { addDays } from '../home/homeMath'

/** At most this many rows. */
export const COMING_UP_LIMIT = 6

/**
 * Not-done deliverables that are overdue or due within `days` of `today`,
 * soonest (most overdue) first, at most `limit`.
 */
export function comingUp(deliverables, today, days, limit = COMING_UP_LIMIT) {
  const until = addDays(today, days)
  return deliverables
    .filter((d) => d.status !== 'done' && !d.archived_at && (d.overdue || d.due_date <= until))
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.name.localeCompare(b.name))
    .slice(0, limit)
}
