// Display helpers shared by the pages.

const money = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const day = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** 52000 -> "52,000.00" (the API sends money as plain numbers, no currency). */
export const formatMoney = (amount) => money.format(amount)

/** 25.8 -> "25.8%", 40 -> "40.0%"; null -> "—". The API sends one decimal. */
export const formatPercent = (value) => (value === null || value === undefined ? '—' : `${value.toFixed(1)}%`)

/** "2026-11-02" -> "Nov 2, 2026". Dates are calendar days, so they are read as UTC. */
export function formatDate(date) {
  if (!date) return '—'
  return day.format(new Date(`${date}T00:00:00Z`))
}

const monthDay = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** Monday "2026-12-28" -> "week of Dec 28, 2026". Every week label carries its year. */
export function formatWeek(date) {
  return date ? `week of ${formatDate(date)}` : '—'
}

/** Monday "2026-12-28" -> "Dec 28 ’26": the compact form for column headers and lists, still with the year. */
export function formatWeekShort(date) {
  if (!date) return '—'
  return `${monthDay.format(new Date(`${date}T00:00:00Z`))} ’${date.slice(2, 4)}`
}

export const PROJECT_STATUS = {
  planned: 'Planned',
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
}

export const DELIVERABLE_STATUS = {
  not_started: 'Not started',
  in_progress: 'In progress',
  done: 'Done',
}

export const ROLE_LABELS = { admin: 'Admin', manager: 'Manager', employee: 'Employee' }

export const RISK_REASONS = {
  past_end_date: 'Past its end date',
  overdue_deliverable: 'Overdue deliverable',
  blocked_past_start: 'Blocked after its start date',
  dependency_date_conflict: 'Starts before a dependency is due',
  unstaffed: 'No one assigned this week',
  over_budget: 'Over budget',
}

/** Message shown instead of money when the group is too small (§7). */
export const HIDDEN_REASONS = {
  below_min_group:
    'Totals are hidden because fewer than 3 people are in this group, so they could reveal someone’s pay.',
}
export const hiddenMessage = (reason) =>
  HIDDEN_REASONS[reason] ?? 'Totals are hidden to protect individual pay.'
