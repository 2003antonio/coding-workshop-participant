import Chip from '@mui/material/Chip'
import { toneSx } from '../theme'

/**
 * The "over budget" flag as a labelled chip. Without a planned budget there is
 * nothing to be over, so it says that instead.
 */
export default function BudgetFlag({ plannedBudget, overBudget }) {
  if (plannedBudget === null || plannedBudget === undefined) {
    return <Chip size="small" label="No planned budget" sx={toneSx('not_started')} />
  }
  return overBudget
    ? <Chip size="small" label="Over budget" sx={toneSx('over_budget')} />
    : <Chip size="small" label="Within budget" sx={toneSx('done')} />
}
