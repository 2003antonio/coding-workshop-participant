import { useCallback } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Skeleton from '@mui/material/Skeleton'
import Typography from '@mui/material/Typography'
import { canSeeSalaries } from '../auth/roles'
import { useLoad } from '../auth/useApi'
import * as budgetService from '../services/budgetService'
import { formatMoney, formatPercent } from '../pages/format'
import BudgetBar from './BudgetBar'
import BudgetFlag from './BudgetFlag'
import BudgetPanel from './BudgetPanel'
import { LoadState } from './PageState'
import ResponsiveTable from './ResponsiveTable'

/**
 * The project header's budget: the same bar as Home and Reports (committed
 * against planned, spent so far inside it, "Over budget" only when over), in
 * words with $ amounts. Hidden totals say "Hidden", never 0.
 */
export function ProjectBudgetBar({ project }) {
  const load = useCallback(
    (call) => call((token) => budgetService.getProjectBudget(token, project.id)),
    [project.id],
  )
  const result = useLoad(load)
  const text = (children, color = 'text.secondary') => <Typography variant="body2" color={color}>{children}</Typography>

  if (result.status === 'loading') {
    return <Box role="status" aria-label="Loading budget summary"><Skeleton variant="rounded" width={240} height={8} /></Box>
  }
  if (result.status === 'error') {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {text("The budget summary didn't load.")}
        <Button size="small" onClick={result.reload}>Try again</Button>
      </Box>
    )
  }
  return (
    <Box component="section" aria-label="Budget summary" sx={{ maxWidth: 440 }}>
      <BudgetBar budget={result.data} name={<Typography variant="subtitle2" component="span">Budget</Typography>} />
    </Box>
  )
}

/**
 * The planned budget (typed by the manager or an admin, not pay data, so always
 * shown), then committed cost, used to date, percent used and the over-budget
 * flag, or why those are hidden. The per-person lines (hourly rates) are shown
 * to admins only, even if a response for someone else were ever to contain them.
 */
export default function ProjectBudgetSection({ project, role }) {
  const load = useCallback(
    (call) => call((token) => budgetService.getProjectBudget(token, project.id)),
    [project.id],
  )
  const result = useLoad(load)
  const showLines = canSeeSalaries(role)

  return (
    <LoadState result={result} label="Loading budget" skeleton="cards">
      {(budget) => {
        const hasBudget = budget.planned_budget !== null && budget.planned_budget !== undefined
        const people = budget.allocated_people
        return (
          <BudgetPanel title="Project budget" hiddenReason={budget.hidden_reason}
            summary={[['Planned budget', budget.planned_budget, hasBudget ? undefined : 'Not set']]}
            figures={[
              ['Committed cost', budget.committed_cost],
              ['Used to date', budget.used_cost_to_date],
              ...(hasBudget ? [['Percent used', budget.percent_used, formatPercent(budget.percent_used)]] : []),
            ]}
            status={<BudgetFlag plannedBudget={budget.planned_budget} overBudget={budget.over_budget} />}
            footnote={`${people} ${people === 1 ? 'person' : 'people'} assigned. Committed cost counts every week `
              + 'of every assignment; used to date counts the weeks up to and including this one.'}>
            {showLines && budget.lines && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle1" component="h3" gutterBottom>Cost per assignment</Typography>
                <ResponsiveTable label="Cost per assignment" rows={budget.lines} rowKey={(l) => l.allocation_id}
                  empty="No assignments yet." columns={[
                    { key: 'person', label: 'Person', primary: true, render: (l) => l.employee.name },
                    { key: 'hours', label: 'Hours per week', align: 'right', render: (l) => l.hours_per_week },
                    { key: 'weeks', label: 'Weeks', align: 'right', render: (l) => l.weeks },
                    { key: 'rate', label: 'Hourly rate', align: 'right', render: (l) => formatMoney(l.hourly_rate) },
                    { key: 'committed', label: 'Committed', align: 'right', render: (l) => formatMoney(l.committed_cost) },
                    { key: 'used', label: 'Used to date', align: 'right', render: (l) => formatMoney(l.used_cost_to_date) },
                  ]} />
              </Box>
            )}
          </BudgetPanel>
        )
      }}
    </LoadState>
  )
}
