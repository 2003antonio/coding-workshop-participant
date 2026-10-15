// The signed-in person's hours per week, for the My work chart.
// Weeks are identified by their Monday (docs/api-contract.md §1); an
// allocation counts in every week its date range touches.

/** The 40-hour rule (§6) and report 5's default "near capacity" line. */
export const MAX_HOURS = 40
export const NEAR_CAPACITY_HOURS = 32

const DAY = 86400000
const toTime = (date) => Date.parse(`${date}T00:00:00Z`)

/** "2026-11-12" -> "2026-11-09" (the Monday of its week). */
export function mondayOf(date) {
  const time = toTime(date)
  const weekday = (new Date(time).getUTCDay() + 6) % 7
  return new Date(time - weekday * DAY).toISOString().slice(0, 10)
}

/** Does the allocation touch the week starting on Monday `week`? */
const touches = (a, week) => mondayOf(a.start_date) <= week && a.end_date >= week

/**
 * One person's weeks, in report 3's shape: [{ week_start, total_hours, other_hours, projects: [{ id, name, hours }] }].
 * Built from their own allocations when report 3 does not list them (a manager is
 * not a member of the team they lead, so their own row is not in their scope).
 */
export function weeksFromAllocations(weeks, allocations) {
  return weeks.map((week_start) => {
    const byProject = new Map()
    for (const a of allocations) {
      if (a.archived_at || !touches(a, week_start)) continue
      const seen = byProject.get(a.project.id)
      byProject.set(a.project.id, { id: a.project.id, name: a.project.name, hours: (seen?.hours ?? 0) + a.hours_per_week })
    }
    const projects = [...byProject.values()]
    return { week_start, total_hours: projects.reduce((s, p) => s + p.hours, 0), other_hours: 0, projects }
  })
}

/** The projects in these weeks, in order of first appearance (so each keeps its colour). */
export function projectsIn(weeks) {
  const seen = new Map()
  for (const w of weeks) for (const p of w.projects) if (!seen.has(p.id)) seen.set(p.id, { id: p.id, name: p.name })
  return [...seen.values()]
}
