// What the dashboard cards and bars say, from the report rows (docs/api-contract.md §8).
// Never a made-up number: hidden stays hidden, a missing budget stays missing.

/** At or above this share of the plan committed, a budget bar turns amber. */
export const CLOSE_PERCENT = 80

const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
/** 41180.4 -> "$41,180": a project total in whole dollars (never a per-person figure). */
export const formatDollars = (amount) => dollars.format(amount)
const wholePercent = (value) => `${Math.round(value)}%`
const isSet = (value) => value !== null && value !== undefined

/**
 * What one project's budget bar says (report 7 row). Two measures, never mixed:
 *   committedPct  committed_cost / planned_budget × 100 (the main bar; over_budget compares these)
 *   spentPct      percent_used, spent to date / planned_budget (the darker inner fill)
 * kind:
 *   hidden  the server hid the costs (fewer than 3 people)
 *   none    no planned budget
 *   over    over_budget is true: committed is above planned
 *   close   committed at or above CLOSE_PERCENT of planned
 *   ok      the rest
 */
export function budgetState(p) {
  if (p.hidden_reason) return { kind: 'hidden', text: 'Hidden: fewer than 3 people' }
  if (!isSet(p.planned_budget)) return { kind: 'none', text: 'No budget set' }
  const committedPct = isSet(p.committed_cost) && p.planned_budget > 0 ? (p.committed_cost / p.planned_budget) * 100 : null
  let kind = 'ok'
  if (p.over_budget) kind = 'over'
  else if (committedPct !== null && committedPct >= CLOSE_PERCENT) kind = 'close'
  const committed = isSet(p.committed_cost)
    ? `Committed ${formatDollars(p.committed_cost)} of ${formatDollars(p.planned_budget)} planned`
      + (committedPct === null ? '' : ` (${wholePercent(committedPct)})`)
    : null
  const spent = isSet(p.percent_used) ? `Spent so far: ${wholePercent(p.percent_used)}` : null
  return { kind, committedPct, spentPct: isSet(p.percent_used) ? p.percent_used : null, committed, spent }
}

/**
 * The bar's right end, in percent of the plan: always past 100 so the 100%
 * marker shows and 108% visibly passes it; at most 200 (longer bars are cut off).
 */
export function barScale({ committedPct, spentPct }) {
  return Math.min(Math.max(110, (committedPct ?? 0) + 10, (spentPct ?? 0) + 10), 200)
}

/** Over-budget count, or "Hidden" when the server hid every project's costs (never a made-up 0). */
export function overBudgetCount({ projects }) {
  const hidden = projects.filter((p) => p.hidden_reason).length
  const shown = projects.filter((p) => !p.hidden_reason)
  if (hidden > 0 && shown.length === 0) return { value: 'Hidden', note: 'Fewer than 3 people on these projects' }
  const value = shown.filter((p) => p.over_budget === true).length
  return { value, note: hidden > 0 ? `${hidden} more hidden: fewer than 3 people` : 'Committed cost above the plan' }
}

/** Report 1: projects with status active. */
export const activeCount = ({ projects }) => ({
  value: projects.filter((p) => p.status === 'active').length,
  note: `${projects.length} ${projects.length === 1 ? 'project' : 'projects'} in total`,
})

/** Report 1: overdue deliverables across the projects. */
export const overdueCount = ({ projects }) => ({
  value: projects.reduce((sum, p) => sum + (p.deliverables?.overdue ?? 0), 0),
  note: 'Past their due date, not done',
})

/** Report 2: projects with at least one reason. */
export const atRiskCount = ({ projects }) => ({ value: projects.length, note: 'With at least one risk' })

/** Report 5: people above the threshold in some week. */
export const nearCapacityCount = ({ people, threshold }) => ({
  value: people.length,
  note: `Above ${threshold} h in a week, next 12 weeks`,
})

/**
 * Portfolio health from reports 1, 2 and 7: each project counted once as over
 * budget (report 7 says so), else at risk (report 2 lists it), else healthy.
 * A project whose costs the server hid is never counted as over budget; `hidden`
 * says how many those are, so the words can say so (never a made-up 0).
 */
export function portfolioHealth(statusData, riskData, budgetData) {
  const over = new Set(budgetData.projects.filter((p) => !p.hidden_reason && p.over_budget === true).map((p) => p.id))
  const risky = new Set(riskData.projects.map((p) => p.id))
  const counts = { healthy: 0, at_risk: 0, over_budget: 0 }
  for (const p of statusData.projects) {
    if (over.has(p.id)) counts.over_budget += 1
    else if (risky.has(p.id)) counts.at_risk += 1
    else counts.healthy += 1
  }
  return { ...counts, hidden: budgetData.projects.filter((p) => p.hidden_reason).length }
}

/** Rows a dashboard list shows (like COMING_UP_LIMIT); a "View all" link leads to the full report. */
export const DASHBOARD_LIST_LIMIT = 6

/** At-risk projects worth a look first: the most reasons first (ties keep the report's order). */
export function topAtRisk(projects, limit = DASHBOARD_LIST_LIMIT) {
  return [...projects].sort((a, b) => b.reasons.length - a.reasons.length).slice(0, limit)
}

const BUDGET_RANK = { over: 0, close: 1, ok: 2, none: 3, hidden: 4 }
/** Budget bars worth a look first: over, then close, then the rest; the most committed first within each. */
export function topBudgets(projects, limit = DASHBOARD_LIST_LIMIT) {
  return projects
    .map((p) => ({ p, state: budgetState(p) }))
    .sort((a, b) => BUDGET_RANK[a.state.kind] - BUDGET_RANK[b.state.kind]
      || (b.state.committedPct ?? -1) - (a.state.committedPct ?? -1))
    .slice(0, limit)
    .map(({ p }) => p)
}

/** Where each Home number leads: the list it counts, with its filter already on (hooks/useUrlFilter.js). */
export const DASHBOARD_LINKS = {
  active: '/projects?status=active',
  atRisk: '/reports?tab=at-risk',
  overdue: '/reports?tab=deliverables&overdue=1',
  overBudget: '/reports?tab=budget&over=1',
  nearCapacity: '/reports?tab=near-capacity',
}
