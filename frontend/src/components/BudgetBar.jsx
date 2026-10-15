import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'
import { toneSx } from '../theme'
import { barScale, budgetState } from './dashboard/dashboardMath'
import { useMotion } from './motion/motion'

// Bar colours by kind, from theme names so light and dark both work. The
// committed bar is the colour at partial opacity; spent-to-date is the same
// colour solid, so it reads as the darker inner part. The track stays neutral.
const FILL = { over: 'error.main', close: 'warning.main', ok: 'primary.main' }
const width = (value, scale) => `${(Math.min(Math.max(value ?? 0, 0), scale) / scale) * 100}%`

/** Committed against planned (main bar, with a marker at 100%) and spent so far (inner fill). */
function Bar({ state, index }) {
  const motion = useMotion()
  const scale = barScale(state)
  const fill = { position: 'absolute', inset: '0 auto 0 0', bgcolor: FILL[state.kind], ...motion('grow', index) }
  return (
    <Box aria-hidden="true" data-kind={state.kind}
      sx={{ position: 'relative', mt: 0.75, height: 12, borderRadius: 1, bgcolor: 'action.disabledBackground' }}>
      <Box data-part="committed" sx={{ ...fill, width: width(state.committedPct, scale), opacity: 0.4, borderRadius: 1 }} />
      <Box data-part="spent" sx={{ ...fill, width: width(state.spentPct, scale), borderRadius: 1 }} />
      <Box data-part="plan" sx={{
        position: 'absolute', top: -3, bottom: -3, left: width(100, scale), width: 2, ml: '-1px', bgcolor: 'text.primary',
      }} />
    </Box>
  )
}

/**
 * One project's budget, the same everywhere (Home, the project header, Reports):
 *   <BudgetBar budget={row} name={<Link ...>Billing v2</Link>} />
 * `budget` has planned_budget, committed_cost, percent_used, over_budget and
 * hidden_reason (a report 7 row or GET /projects/{id}/budget). Words say which
 * measure is which; "Over budget" shows only when over_budget is true; hidden
 * costs say "Hidden", never 0. `words={false}` leaves out the two lines under
 * the bar (for a table whose columns already show the amounts).
 */
export default function BudgetBar({ budget, name, index = 0, words = true }) {
  const state = budgetState(budget)
  const hasBar = state.committedPct !== null && state.committedPct !== undefined
  return (
    <Box data-testid="budget-bar">
      {(name || state.kind === 'over' || state.kind === 'close') && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
          {name && <Box sx={{ mr: 'auto' }}>{name}</Box>}
          {state.kind === 'over' && <Chip size="small" label="Over budget" sx={toneSx('over_budget')} />}
          {state.kind === 'close' && <Chip size="small" label="Close to budget" sx={toneSx('blocked')} />}
        </Box>
      )}
      {state.text && <Typography variant="body2" color="text.secondary">{state.text}</Typography>}
      {hasBar && <Bar state={state} index={index} />}
      {words && state.committed && <Typography variant="body2" sx={{ mt: 0.5 }}>{state.committed}</Typography>}
      {words && state.spent && <Typography variant="body2" color="text.secondary">{state.spent}</Typography>}
    </Box>
  )
}
