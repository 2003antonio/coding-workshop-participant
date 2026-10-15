// What an employee's Home says, from their own allocations and the deliverable
// report (docs/api-contract.md §6, §8). Weeks are Mondays, as everywhere else.
import { formatDate, formatWeekShort } from '../../pages/format'
import { mondayOf, weeksFromAllocations } from '../mywork/weekMath'

const DAY = 86400000
/** "Due soon" means due within this many days from today. */
export const DUE_SOON_DAYS = 7

/** Today's calendar date on this computer (local time, not UTC), as YYYY-MM-DD. */
export function localToday(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** `date` plus `days`, both YYYY-MM-DD calendar days. */
export function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10)
}

/** `count` Mondays starting with the week of `today`. */
export function weeksFrom(today, count) {
  const first = mondayOf(today)
  return Array.from({ length: count }, (_, i) => addDays(first, i * 7))
}

/**
 * One line about the coming weeks, e.g. "20 h per week through the week of Dec 7, then free."
 * Looks `horizon` weeks ahead; null when there is nothing booked at all.
 */
export function workloadSummary(allocations, today, horizon = 26) {
  const weeks = weeksFromAllocations(weeksFrom(today, horizon), allocations)
  const first = weeks.findIndex((w) => w.total_hours > 0)
  if (first === -1) return null
  if (first > 0) {
    return `Free this week. ${weeks[first].total_hours} h per week from the week of ${formatWeekShort(weeks[first].week_start)}.`
  }
  const hours = weeks[0].total_hours
  const change = weeks.findIndex((w) => w.total_hours !== hours)
  if (change === -1) return `${hours} h per week for the next ${horizon} weeks.`
  const last = formatWeekShort(weeks[change - 1].week_start)
  const next = weeks[change].total_hours
  return `${hours} h per week through the week of ${last}, then ${next === 0 ? 'free' : `${next} h`}.`
}

/** This week's booked hours. */
export function hoursThisWeek(allocations, today) {
  return weeksFromAllocations(weeksFrom(today, 1), allocations)[0].total_hours
}

/** The not-done deliverable due soonest, today or later, or null. */
export function nextDeadline(deliverables, today) {
  return deliverables
    .filter((d) => d.status !== 'done' && d.due_date >= today)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))[0] ?? null
}

/** Not-done deliverables that are overdue or due within DUE_SOON_DAYS, soonest first. */
export function overdueOrSoon(deliverables, today) {
  const soon = addDays(today, DUE_SOON_DAYS)
  return deliverables
    .filter((d) => d.status !== 'done' && (d.overdue || d.due_date < today || d.due_date <= soon))
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
}

/** "Due Oct 11, 2026" or "Overdue since Oct 11, 2026". */
export function dueText(d, today) {
  return d.overdue || d.due_date < today ? `Overdue since ${formatDate(d.due_date)}` : `Due ${formatDate(d.due_date)}`
}

/** One entry per project in the allocations, with the person's total hours on it. */
export function myProjects(allocations) {
  const byId = new Map()
  for (const a of allocations) {
    if (a.archived_at) continue
    const seen = byId.get(a.project.id)
    byId.set(a.project.id, {
      id: a.project.id, name: a.project.name, hours: (seen?.hours ?? 0) + a.hours_per_week,
      end: seen && seen.end > a.end_date ? seen.end : a.end_date,
    })
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** "Good morning" / "Good afternoon" / "Good evening", from the hour on this computer. */
export function greeting(now = new Date()) {
  const hour = now.getHours()
  if (hour < 12) return 'Good morning'
  return hour < 18 ? 'Good afternoon' : 'Good evening'
}
