import Chip from '@mui/material/Chip'

/**
 * The "over budget" flag as a labelled chip. Without a planned budget there is
 * nothing to be over, so it says that instead.
 */
export default function BudgetFlag({ plannedBudget, overBudget }) {
  if (plannedBudget === null || plannedBudget === undefined) {
    return <Chip size="small" variant="outlined" label="No planned budget" />
  }
  return overBudget
    ? <Chip size="small" color="error" label="Over budget" />
    : <Chip size="small" color="success" variant="outlined" label="Within budget" />
}
