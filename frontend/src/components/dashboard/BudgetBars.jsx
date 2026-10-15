import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import { Link as RouterLink } from 'react-router-dom'
import { toneSx } from '../../theme'
import { useMotion } from '../motion/motion'
import { Empty } from '../PageState'
import { barScale, budgetState } from './dashboardMath'

// Bar colours by kind, from theme names so light and dark both work. The
// committed bar is the colour at partial opacity; spent-to-date is the same
// colour solid, so it reads as the darker inner part.
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

/** Report 7 as one bar per project. Labels say which measure is which. */
export default function BudgetBars({ projects }) {
  if (projects.length === 0) return <Empty>No projects to report on.</Empty>
  return (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Light bar: cost committed by assignments. Dark part: spent so far. The line marks the planned budget.
      </Typography>
      <Box component="ul" aria-label="Budget used by project" sx={{ listStyle: 'none', p: 0, m: 0, display: 'grid', gap: 2 }}>
        {projects.map((p, i) => {
          const state = budgetState(p)
          const hasBar = state.committedPct !== null && state.committedPct !== undefined
          return (
            <li key={p.id}>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
                <Link component={RouterLink} to={`/projects/${encodeURIComponent(p.id)}`} sx={{ mr: 'auto' }}>{p.name}</Link>
                {state.kind === 'over' && <Chip size="small" label="Over budget" sx={toneSx('over_budget')} />}
                {state.kind === 'close' && <Chip size="small" label="Close to budget" sx={toneSx('blocked')} />}
              </Box>
              {state.text && <Typography variant="body2" color="text.secondary">{state.text}</Typography>}
              {hasBar && <Bar state={state} index={i} />}
              {state.committed && <Typography variant="body2" sx={{ mt: 0.5 }}>{state.committed}</Typography>}
              {state.spent && <Typography variant="body2" color="text.secondary">{state.spent}</Typography>}
            </li>
          )
        })}
      </Box>
    </>
  )
}
