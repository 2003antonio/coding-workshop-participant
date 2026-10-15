// Before a project's dates are saved: which active deliverables and assignments would fall
// outside the new dates (the server refuses that with 409 dates_conflict, which stays the fallback).
import { formatDate } from '../pages/format'

/** At most this many offenders are named; the rest are counted. */
const NAMED = 3

/**
 * Sentences for the new start and end dates, or null when nothing is outside:
 *   { start: 'App design starts Oct 26, 2026, before the new start date.', end: null }
 * The project's own dates are never offenders; archived rows are ignored.
 */
export function datesConflicts(start, end, deliverables = [], allocations = []) {
  const early = []
  const late = []
  for (const d of deliverables.filter((x) => !x.archived_at)) {
    if (start && d.start_date < start) early.push(`${d.name} starts ${formatDate(d.start_date)}`)
    if (end && d.due_date > end) late.push(`${d.name} is due ${formatDate(d.due_date)}`)
  }
  for (const a of allocations.filter((x) => !x.archived_at)) {
    if (start && a.start_date < start) early.push(`${a.employee.name}'s assignment starts ${formatDate(a.start_date)}`)
    if (end && a.end_date > end) late.push(`${a.employee.name}'s assignment ends ${formatDate(a.end_date)}`)
  }
  const say = (list, tail) => {
    if (list.length === 0) return null
    const named = list.slice(0, NAMED).map((x) => `${x}, ${tail}.`).join(' ')
    const more = list.length - NAMED
    return more > 0 ? `${named} And ${more} more.` : named
  }
  return { start: say(early, 'before the new start date'), end: say(late, 'after the new end date') }
}
