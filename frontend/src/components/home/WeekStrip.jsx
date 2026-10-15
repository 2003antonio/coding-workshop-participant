import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { formatWeekShort } from '../../pages/format'
import { useMotion } from '../motion/motion'
import { MAX_HOURS } from '../mywork/weekMath'
import { visuallyHidden } from '../viz/vizMath'

const HEIGHT = 72 // px for 40 h (a little room above for weeks past the limit)
const SCALE = MAX_HOURS + 4

/**
 * The coming weeks as a compact strip of bars against the 40 h line. The bars are
 * decoration; a hidden list says every week's hours, and weeks over 40 h say so.
 *   <WeekStrip weeks={[{ week_start, total_hours }, ...]} footer={<Link>See full breakdown</Link>} />
 */
export default function WeekStrip({ weeks, footer }) {
  const motion = useMotion()
  const top = (hours) => `${(Math.min(hours, SCALE) / SCALE) * 100}%`
  return (
    <Paper component="section" variant="outlined" aria-labelledby="week-strip-heading" sx={{ p: 2, minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, flexWrap: 'wrap', mb: 1.5 }}>
        <Typography id="week-strip-heading" component="h2" variant="h6" sx={{ flexGrow: 1 }}>
          Next {weeks.length} weeks
        </Typography>
        {footer}
      </Box>
      <Box component="ul" sx={visuallyHidden} aria-label={`Your hours per week, next ${weeks.length} weeks`}>
        {weeks.map((w) => (
          <li key={w.week_start}>
            {formatWeekShort(w.week_start)}: {w.total_hours} h{w.total_hours > MAX_HOURS ? ', over the 40 h limit' : ''}
          </li>
        ))}
      </Box>
      <Box aria-hidden="true">
        <Box sx={{ position: 'relative', height: HEIGHT, display: 'flex', alignItems: 'flex-end', gap: { xs: '3px', sm: 1 } }}>
          <Box sx={{
            position: 'absolute', left: 0, right: 0, bottom: top(MAX_HOURS), borderTop: 2, borderColor: 'text.primary', opacity: 0.6,
          }} />
          <Typography variant="caption" color="text.secondary" sx={{
            position: 'absolute', right: 0, bottom: top(MAX_HOURS), transform: 'translateY(-2px)', lineHeight: 1,
            bgcolor: 'background.paper', pl: 0.5,
          }}>
            {MAX_HOURS} h
          </Typography>
          {weeks.map((w, i) => (
            <Box key={w.week_start} sx={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', minWidth: 0 }}>
              <Box title={`${w.total_hours} h`} sx={[{
                width: '100%', height: top(w.total_hours), minHeight: w.total_hours > 0 ? 3 : 0,
                borderRadius: '4px 4px 0 0',
                bgcolor: w.total_hours > MAX_HOURS ? 'error.main' : 'secondary.main',
                transformOrigin: 'bottom',
              }, motion('fade', i)]} />
            </Box>
          ))}
        </Box>
        <Box sx={{ display: 'flex', gap: { xs: '3px', sm: 1 }, mt: 0.5 }}>
          {weeks.map((w, i) => (
            <Typography key={w.week_start} variant="caption" color="text.secondary"
              sx={{ flex: 1, minWidth: 0, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden',
                visibility: { xs: i % 3 === 0 ? 'visible' : 'hidden', sm: i % 2 === 0 ? 'visible' : 'hidden' } }}>
              {formatWeekShort(w.week_start).replace(/ ’\d\d$/, '')}
            </Typography>
          ))}
        </Box>
      </Box>
    </Paper>
  )
}
