import Box from '@mui/material/Box'
import { useMotion } from '../motion/motion'

/**
 * A small ring that fills to value / max, with a short text in the middle.
 * It is one image named by `label` (a full sentence), and the text beside or in
 * it says the number too, so colour is never the only signal. Above max the ring
 * is full and turns to the error colour.
 *   <RingGauge value={20} max={40} label="20 of 40 hours booked this week">20 h</RingGauge>
 */
export default function RingGauge({ value, max, label, size = 64, thickness = 7, children }) {
  const motion = useMotion()
  const r = (size - thickness) / 2
  const length = 2 * Math.PI * r
  const share = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0
  const over = value > max
  return (
    <Box role="img" aria-label={label} sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <Box component="svg" viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true"
        sx={{ display: 'block', transform: 'rotate(-90deg)' }}>
        <Box component="circle" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={thickness}
          sx={{ stroke: 'currentColor', color: 'action.disabledBackground' }} />
        {share > 0 && (
          <Box component="circle" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={thickness}
            strokeLinecap="round" strokeDasharray={`${share * length} ${length}`}
            sx={[{ stroke: 'currentColor', color: over ? 'error.main' : 'primary.main' }, motion('fade')]} />
        )}
      </Box>
      {children && (
        <Box aria-hidden="true" sx={{
          position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
          fontSize: Math.round(size * 0.22), fontWeight: 700, lineHeight: 1,
        }}>
          {children}
        </Box>
      )}
    </Box>
  )
}
