// What the project health strip says (components/health/ProjectHealthStrip.jsx),
// from the project's deliverables and assignments. Pure, so it is easy to test.
import { addDays } from '../home/homeMath'
import { mondayOf } from '../mywork/weekMath'

/**
 * Each deliverable counted once, in this order: done, overdue, blocked, in progress, not started.
 * (An overdue deliverable that is also blocked counts as overdue: the more urgent one.)
 */
export function scheduleCounts(deliverables) {
  const counts = { done: 0, overdue: 0, blocked: 0, in_progress: 0, not_started: 0 }
  for (const d of deliverables) {
    if (d.status === 'done') counts.done += 1
    else if (d.overdue) counts.overdue += 1
    else if (d.blocked) counts.blocked += 1
    else if (d.status === 'in_progress') counts.in_progress += 1
    else counts.not_started += 1
  }
  return counts
}

/** The StatusBar segments for scheduleCounts(). */
export const scheduleSegments = (counts) => [
  { key: 'done', label: 'Done', count: counts.done, tone: 'done' },
  { key: 'in_progress', label: 'In progress', count: counts.in_progress, tone: 'in_progress' },
  { key: 'not_started', label: 'Not started', count: counts.not_started, tone: 'not_started' },
  { key: 'blocked', label: 'Blocked', count: counts.blocked, tone: 'blocked' },
  { key: 'overdue', label: 'Overdue', count: counts.overdue, tone: 'overdue' },
]

/** "5 of 9 done, 1 overdue, 2 blocked." / "Nothing scheduled yet." */
export function scheduleSentence(counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  if (total === 0) return 'Nothing scheduled yet.'
  const parts = [`${counts.done} of ${total} done`]
  if (counts.overdue) parts.push(`${counts.overdue} overdue`)
  if (counts.blocked) parts.push(`${counts.blocked} blocked`)
  return `${parts.join(', ')}.`
}

/**
 * People on the project and their hours in the week of `today` (an assignment
 * counts when its dates touch that Monday-to-Sunday week).
 * -> { names: [unique names, in list order], hoursThisWeek }
 */
export function peopleThisWeek(allocations, today) {
  const monday = mondayOf(today)
  const sunday = addDays(monday, 6)
  const names = [...new Set(allocations.map((a) => a.employee.name))]
  const hoursThisWeek = allocations
    .filter((a) => a.start_date <= sunday && a.end_date >= monday)
    .reduce((sum, a) => sum + a.hours_per_week, 0)
  return { names, hoursThisWeek }
}

/** "3 people, 56 h this week" (or "You, 20 h this week" when the list is only the caller's own). */
export function peopleSentence({ names, hoursThisWeek }, ownOnly = false) {
  if (names.length === 0) return 'No one assigned yet.'
  const who = ownOnly ? 'You' : `${names.length} ${names.length === 1 ? 'person' : 'people'}`
  return `${who}, ${hoursThisWeek} h this week`
}
