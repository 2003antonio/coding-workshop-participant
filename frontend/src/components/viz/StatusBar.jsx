import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { useMotion } from '../motion/motion'

/** A segment's fill: the status text colour (strong in both modes), from theme.js STATUS_COLORS. */
const fillSx = (tone) => (theme) => ({
  bgcolor: (theme.vars ?? theme).palette.status?.[tone]?.fg ?? (theme.vars ?? theme).palette.text.secondary,
})

/**
 * Counts as one segmented bar, with a legend that says every count in words
 * (colour is never the only signal; the bar itself is hidden from screen readers):
 *   <StatusBar label="Deliverables by status"
 *     segments={[{ key: 'done', label: 'Done', count: 5, tone: 'done' }, ...]} />
 * Empty segments are left out of the bar, and out of the legend unless `showZero`.
 */
export default function StatusBar({ label, segments, showZero = false, height = 10, legend = true }) {
  const motion = useMotion()
  const total = segments.reduce((sum, s) => sum + s.count, 0)
  const listed = segments.filter((s) => showZero || s.count > 0)
  return (
    <Box data-testid="status-bar" sx={{ minWidth: 0 }}>
      <Box aria-hidden="true" sx={{
        display: 'flex', gap: '2px', height, borderRadius: `${height / 2}px`, overflow: 'hidden',
        bgcolor: 'action.disabledBackground',
      }}>
        {segments.filter((s) => s.count > 0).map((s, i) => (
          <Box key={s.key} data-tone={s.tone}
            sx={[fillSx(s.tone), { flexGrow: s.count, flexBasis: 0, minWidth: 4 }, motion('grow', i)]} />
        ))}
      </Box>
      {legend && (
        <Box component="ul" aria-label={label} sx={{
          display: 'flex', flexWrap: 'wrap', columnGap: 1.5, rowGap: 0.25, listStyle: 'none', p: 0, m: 0, mt: 0.75,
        }}>
          {total === 0 && <Typography component="li" variant="body2" color="text.secondary">None yet</Typography>}
          {total > 0 && listed.map((s) => (
            <Box component="li" key={s.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box aria-hidden="true" sx={[fillSx(s.tone), { width: 8, height: 8, borderRadius: '2px', flexShrink: 0 }]} />
              <Typography variant="body2" component="span">
                {s.label} <Box component="strong" sx={{ fontWeight: 700 }}>{s.count}</Box>
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}
