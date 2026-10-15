import Box from '@mui/material/Box'
import { MAX_HOURS, NEAR_CAPACITY_HOURS } from '../mywork/weekMath'
import { useMotion } from '../motion/motion'

/**
 * A small bar of hours against the 40 h weekly limit (a tick marks 40 h; past
 * 32 h the fill turns amber, past 40 h red). It is one image named in words:
 * "24 of 40 hours a week".
 */
export default function HoursMeter({ hours, width = 72, label }) {
  const motion = useMotion()
  const scale = Math.max(MAX_HOURS + 4, hours)
  const pct = (h) => `${(Math.min(Math.max(h, 0), scale) / scale) * 100}%`
  let color = 'secondary.main'
  if (hours > MAX_HOURS) color = 'error.main'
  else if (hours > NEAR_CAPACITY_HOURS) color = 'warning.main'
  return (
    <Box role="img" aria-label={label ?? `${hours} of ${MAX_HOURS} hours a week`} data-testid="hours-meter"
      sx={{ position: 'relative', width, height: 8, borderRadius: 4, bgcolor: 'action.disabledBackground', flexShrink: 0 }}>
      <Box sx={[{ position: 'absolute', inset: '0 auto 0 0', width: pct(hours), borderRadius: 4, bgcolor: color },
        motion('grow')]} />
      <Box sx={{ position: 'absolute', top: -2, bottom: -2, left: pct(MAX_HOURS), width: 2, ml: '-1px', bgcolor: 'text.primary' }} />
    </Box>
  )
}
