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
import { Masked, RevealButton } from './MaskedMoney'
import { useRevealSet } from './reveal'
import { LoadState } from './PageState'
import { useProjectRefresh } from './projectRefresh'
import ResponsiveTable from './ResponsiveTable'

/** A quiet "Updating…" next to numbers that are being fetched again (the old ones stay meanwhile). */
export function Updating() {
  return (
    <Typography component="span" variant="caption" color="text.secondary" role="status" sx={{ ml: 1, fontWeight: 400 }}>
      Updating…
    </Typography>
  )
}

/**
 * The project header's budget: the same bar as Home and Reports (committed
 * against planned, spent so far inside it, "Over budget" only when over), in
 * words with $ amounts. Hidden totals say "Hidden", never 0. `bare` leaves out
 * its own "Budget" label (the health strip tile has one).
 */
/**
 * A closed (completed) project's budget in one line: "Final cost $X of $Y planned, $Z under"
 * ("over" when above). Only when the server sent the numbers: a hidden budget stays "Hidden".
 */
function finalCost(project, budget) {
  if (project.status !== 'completed' || budget.committed_cost === null || budget.committed_cost === undefined) return null
  if (budget.planned_budget === null || budget.planned_budget === undefined) return `Final cost ${formatMoney(budget.committed_cost)}`
  const gap = budget.planned_budget - budget.committed_cost
  return `Final cost ${formatMoney(budget.committed_cost)} of ${formatMoney(budget.planned_budget)} planned, `
    + `${formatMoney(Math.abs(gap))} ${gap >= 0 ? 'under' : 'over'}`
}

export function ProjectBudgetBar({ project, bare = false }) {
  const load = useCallback(
    (call) => call((token) => budgetService.getProjectBudget(token, project.id)),
    [project.id],
  )
  const { refreshKey } = useProjectRefresh()
  const result = useLoad(load, refreshKey)
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
    <Box component="section" aria-label="Budget summary" aria-busy={result.updating}
      sx={{ maxWidth: bare ? 'none' : 440, opacity: result.updating ? 0.7 : 1, transition: 'opacity 150ms' }}>
      <BudgetBar budget={result.data} words={!finalCost(project, result.data)} name={bare ? (result.updating && <Updating />) : (
        <Typography variant="subtitle2" component="span">
          Budget{result.updating && <Updating />}
        </Typography>
      )} />
      {finalCost(project, result.data) && (
        <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 600 }}>{finalCost(project, result.data)}</Typography>
      )}
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
  const { refreshKey } = useProjectRefresh()
  const result = useLoad(load, refreshKey)
  const showLines = canSeeSalaries(role)
  const reveal = useRevealSet() // per person, masked until the admin clicks the eye

  return (
    <LoadState result={result} label="Loading budget" skeleton="cards">
      {(budget) => {
        const hasBudget = budget.planned_budget !== null && budget.planned_budget !== undefined
        const people = budget.allocated_people
        return (
          <BudgetPanel title="Project budget" updating={result.updating} hiddenReason={budget.hidden_reason}
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
                    { key: 'rate', label: 'Hourly rate', align: 'right', render: (l) => (
                      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, whiteSpace: 'nowrap' }}>
                        <Masked shown={reveal.isShown(l.allocation_id)} what="hourly rate">{formatMoney(l.hourly_rate)}</Masked>
                        <RevealButton shown={reveal.isShown(l.allocation_id)} onToggle={() => reveal.toggle(l.allocation_id)}
                          what="hourly rate" name={l.employee.name} />
                      </Box>
                    ) },
                    { key: 'committed', label: 'Committed', align: 'right', render: (l) => (
                      <Masked shown={reveal.isShown(l.allocation_id)} what="cost">{formatMoney(l.committed_cost)}</Masked>
                    ) },
                    { key: 'used', label: 'Used to date', align: 'right', render: (l) => (
                      <Masked shown={reveal.isShown(l.allocation_id)} what="cost">{formatMoney(l.used_cost_to_date)}</Masked>
                    ) },
                  ]} />
              </Box>
            )}
          </BudgetPanel>
        )
      }}
    </LoadState>
  )
}
