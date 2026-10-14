// The one place that turns the structured `details` of a few 409s into a sentence
// (docs/api-contract.md §5, §6). Built from details only, never from server text.
// The 40-hour details carry weeks and hours only, so other projects are never named.

const shortDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** "2026-10-26" -> "Oct 26". Calendar days, read as UTC so the day never shifts. */
const formatWeek = (date) => shortDay.format(new Date(`${date}T00:00:00Z`))

/** Names for ids, in order; an id not among `deliverables` reads "another deliverable". */
export const namesOf = (ids, deliverables = []) =>
  (ids ?? []).map((id) => deliverables.find((d) => d.id === id)?.name ?? 'another deliverable')

/** [{ week_start, hours }] -> "Over 40 hours in: week of Oct 26 (45 h), week of Nov 2 (45 h)". */
export function weeksOverSentence(weeks) {
  if (!weeks?.length) return null
  return `Over 40 hours in: ${weeks.map((w) => `week of ${formatWeek(w.week_start)} (${w.hours} h)`).join(', ')}`
}

/**
 * The cycle's ids -> "Loop: Pay API -> Billing UI -> Pay API". Each id depends on
 * the next and the last on the first, so the first name is repeated to close it.
 */
export function loopSentence(cycle, deliverables) {
  if (!cycle?.length) return null
  const names = namesOf(cycle, deliverables)
  return `Loop: ${[...names, names[0]].join(' -> ')}`
}

/** The pending ids -> "Still open: API spec, Migration guide". */
export function pendingSentence(pending, deliverables) {
  if (!pending?.length) return null
  return `Still open: ${namesOf(pending, deliverables).join(', ')}`
}

/**
 * The sentence for an ApiError's details, or null when it has none to show.
 * Pass the deliverables the page already loaded so ids become names.
 */
export function detailsSentence(error, { deliverables = [] } = {}) {
  const details = error?.details
  if (error?.code === 'over_allocated') return weeksOverSentence(details?.weeks)
  if (error?.code === 'dependency_cycle') return loopSentence(details?.cycle, deliverables)
  if (error?.code === 'dependencies_not_done') return pendingSentence(details?.pending, deliverables)
  return null
}
