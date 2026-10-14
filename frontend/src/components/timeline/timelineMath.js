// Pure helpers for the dependency timeline: where a bar sits on the date axis,
// which ticks the axis shows, and the flags and sentence for each deliverable.
// Dates are calendar days ("2026-11-02"), handled as UTC so they never shift.
import { DELIVERABLE_STATUS, formatDate } from '../../pages/format'

const DAY = 86400000

/** "2026-11-02" -> a whole day number (days since 1970-01-01). */
export const dayNumber = (date) => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY)

/** A day number -> "2026-11-02". */
export const dayToDate = (day) => new Date(day * DAY).toISOString().slice(0, 10)

/**
 * The days the chart covers: from the earliest start to the day after the latest
 * due date (a bar includes its due day). { start, end, days } in day numbers.
 */
export function spanOf(nodes) {
  if (!nodes.length) return null
  const start = Math.min(...nodes.map((n) => dayNumber(n.start_date)))
  const end = Math.max(...nodes.map((n) => dayNumber(n.due_date))) + 1
  return { start, end, days: Math.max(end - start, 1) }
}

/** Percent of the span from its start to `day`. */
export const percentAt = (day, span) => ((day - span.start) / span.days) * 100

/** A bar from start_date to the end of due_date: { left, width } in percent. */
export function barPosition(node, span) {
  const left = percentAt(dayNumber(node.start_date), span)
  const right = percentAt(dayNumber(node.due_date) + 1, span)
  return { left, width: Math.max(right - left, 0) }
}

const shortDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const monthYear = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })

/**
 * Axis ticks, each with the year: Mondays ("Nov 9, 2026") for spans up to six
 * weeks, else first days of months ("Dec 2026"). At most `maxTicks`, evenly thinned.
 * -> [{ date, label, left }]
 */
export function axisTicks(span, maxTicks = 8) {
  const weekly = span.days <= 42
  const days = []
  if (weekly) {
    const weekday = (new Date(span.start * DAY).getUTCDay() + 6) % 7 // Monday = 0
    for (let d = span.start + ((7 - weekday) % 7); d < span.end; d += 7) days.push(d)
  } else {
    const first = new Date(span.start * DAY)
    let year = first.getUTCFullYear()
    let month = first.getUTCMonth() + (first.getUTCDate() === 1 ? 0 : 1)
    for (;;) {
      const d = Math.round(Date.UTC(year, month, 1) / DAY)
      if (d >= span.end) break
      days.push(d)
      month += 1
      if (month === 12) { month = 0; year += 1 }
    }
  }
  const step = Math.max(1, Math.ceil(days.length / maxTicks))
  return days.filter((_, i) => i % step === 0).map((d) => {
    const date = dayToDate(d)
    const at = new Date(d * DAY)
    const label = weekly ? `${shortDay.format(at)}, ${at.getUTCFullYear()}` : monthYear.format(at)
    return { date, label, left: percentAt(d, span) }
  })
}

/**
 * Per deliverable: { waitsFor: [ids], blocked, overdue, onChain }.
 * blocked = something it waits for is not done; overdue = due before `today` and not done.
 */
export function flagsFor(chain, today) {
  const status = new Map(chain.nodes.map((n) => [n.id, n.status]))
  const onChain = new Set(chain.longest_chain)
  return new Map(chain.nodes.map((n) => {
    const waitsFor = chain.edges.filter((e) => e.to === n.id).map((e) => e.from)
    return [n.id, {
      waitsFor,
      blocked: waitsFor.some((id) => status.get(id) !== 'done'),
      overdue: n.status !== 'done' && n.due_date < today,
      onChain: chain.longest_chain.length > 1 && onChain.has(n.id),
    }]
  }))
}

/**
 * "Backend: in progress, blocked, starts Nov 9, 2026, due Dec 4, 2026, waits for API spec,
 * on the longest chain." `names` maps ids to names.
 */
export function sentenceFor(node, flags, names) {
  const parts = [(DELIVERABLE_STATUS[node.status] ?? node.status).toLowerCase()]
  if (flags.overdue) parts.push('overdue')
  if (flags.blocked) parts.push('blocked')
  parts.push(`starts ${formatDate(node.start_date)}`, `due ${formatDate(node.due_date)}`)
  if (flags.waitsFor.length) parts.push(`waits for ${flags.waitsFor.map((id) => names.get(id) ?? 'another deliverable').join(' and ')}`)
  if (flags.onChain) parts.push('on the longest chain')
  return `${node.name}: ${parts.join(', ')}.`
}
