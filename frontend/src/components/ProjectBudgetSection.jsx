import { useCallback } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { canSeeSalaries } from '../auth/roles'
import { useLoad } from '../auth/useApi'
import * as budgetService from '../services/budgetService'
import { formatMoney } from '../pages/format'
import BudgetPanel from './BudgetPanel'
import { LoadState } from './PageState'
import ResponsiveTable from './ResponsiveTable'

/**
 * Planned, used and remaining cost from the assignments (§7), or why the totals
 * are hidden. The per-person lines (hourly rates) are shown to admins only, even
 * if a response for someone else were ever to contain them.
 */
export default function ProjectBudgetSection({ project, role }) {
  const load = useCallback(
    (call) => call((token) => budgetService.getProjectBudget(token, project.id)),
    [project.id],
  )
  const result = useLoad(load)
  const showLines = canSeeSalaries(role)

  return (
    <LoadState result={result} label="Loading budget">
      {(budget) => (
        <BudgetPanel title="Project budget" hiddenReason={budget.hidden_reason}
          figures={[['Planned', budget.planned], ['Used so far', budget.used], ['Remaining', budget.remaining]]}
          footnote={`${budget.allocated_people} ${budget.allocated_people === 1 ? 'person' : 'people'} assigned. `
            + 'Costs come from hours per week and pay, counted for every week an assignment touches.'}>
          {showLines && budget.lines && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle1" component="h3" gutterBottom>Cost per assignment</Typography>
              <ResponsiveTable label="Cost per assignment" rows={budget.lines} rowKey={(l) => l.allocation_id}
                empty="No assignments yet." columns={[
                  { key: 'person', label: 'Person', primary: true, render: (l) => l.employee.name },
                  { key: 'hours', label: 'Hours per week', align: 'right', render: (l) => l.hours_per_week },
                  { key: 'weeks', label: 'Weeks', align: 'right', render: (l) => l.weeks },
                  { key: 'rate', label: 'Hourly rate', align: 'right', render: (l) => formatMoney(l.hourly_rate) },
                  { key: 'planned', label: 'Planned', align: 'right', render: (l) => formatMoney(l.planned) },
                  { key: 'used', label: 'Used', align: 'right', render: (l) => formatMoney(l.used) },
                ]} />
            </Box>
          )}
        </BudgetPanel>
      )}
    </LoadState>
  )
}
