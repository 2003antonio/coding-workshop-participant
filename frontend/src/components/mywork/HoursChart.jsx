// Hours per week as hand-drawn stacked bars: one row per week, one segment per
// project, a solid line at 40 h and a dashed one at 32 h. The drawing is hidden
// from screen readers; a visually hidden table says the same thing.
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'
import { formatWeek, formatWeekShort } from '../../pages/format'
import { toneSx } from '../../theme'
import { useMotion } from '../motion/motion'
import { MAX_HOURS, NEAR_CAPACITY_HOURS, projectsIn } from './weekMath'

const visuallyHidden = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden',
  clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
}

/** Project colours, from theme names so both modes work. The legend names each one. */
const COLORS = ['primary.main', 'secondary.main', 'warning.main', 'success.main', 'error.main', 'text.secondary']
const OTHER_COLOR = 'action.disabled'
const SCALE = MAX_HOURS + 4 // a little room past 40 so the 40 h line is visible
const at = (hours) => `${(Math.min(hours, SCALE) / SCALE) * 100}%`

function Legend({ projects, hasOther }) {
  const items = [
    ...projects.map((p, i) => ({ key: p.id, name: p.name, color: COLORS[i % COLORS.length] })),
    ...(hasOther ? [{ key: 'other', name: 'Other projects', color: OTHER_COLOR }] : []),
  ]
  return (
    <Box component="ul" aria-label="Projects in the chart"
      sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, listStyle: 'none', p: 0, m: 0, mb: 1.5 }}>
      {items.map((item) => (
        <Box component="li" key={item.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Box aria-hidden="true" sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: item.color }} />
          <Typography variant="body2">{item.name}</Typography>
        </Box>
      ))}
      <Box component="li" sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Box aria-hidden="true" sx={{ width: 14, borderTop: 2, borderStyle: 'dashed', borderColor: 'text.secondary' }} />
        <Typography variant="body2">{NEAR_CAPACITY_HOURS} h</Typography>
      </Box>
      <Box component="li" sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Box aria-hidden="true" sx={{ width: 14, borderTop: 2, borderColor: 'text.primary' }} />
        <Typography variant="body2">{MAX_HOURS} h limit</Typography>
      </Box>
    </Box>
  )
}

/**
 * The same numbers as a table, for screen readers. A <table> ignores a 1 px
 * width and grows to fit its cells, so the clipping box wraps it (otherwise the
 * page scrolls sideways on a phone).
 */
function HiddenTable({ weeks, projects, hasOther }) {
  return (
    <Box sx={visuallyHidden}>
      <table>
        <caption>Hours per week, from the {formatWeek(weeks[0]?.week_start)}</caption>
        <thead>
          <tr>
            <th scope="col">Week</th>
            {projects.map((p) => <th key={p.id} scope="col">{p.name}</th>)}
            {hasOther && <th scope="col">Other projects</th>}
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.week_start}>
              <th scope="row">{formatWeek(w.week_start)}</th>
              {projects.map((p) => <td key={p.id}>{w.projects.find((x) => x.id === p.id)?.hours ?? 0} h</td>)}
              {hasOther && <td>{w.other_hours} h</td>}
              <td>{w.total_hours} h{w.total_hours > NEAR_CAPACITY_HOURS ? ', near capacity' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Box>
  )
}

export default function HoursChart({ weeks }) {
  const motion = useMotion()
  const projects = projectsIn(weeks)
  const hasOther = weeks.some((w) => w.other_hours > 0)
  const colorOf = (id) => COLORS[projects.findIndex((p) => p.id === id) % COLORS.length]

  return (
    <>
      <Legend projects={projects} hasOther={hasOther} />
      <HiddenTable weeks={weeks} projects={projects} hasOther={hasOther} />
      <Box aria-hidden="true" data-testid="hours-chart" sx={{ display: 'grid', gap: 0.75 }}>
        {weeks.map((w, i) => {
          const segments = [
            ...w.projects.map((p) => ({ key: p.id, hours: p.hours, color: colorOf(p.id) })),
            ...(w.other_hours ? [{ key: 'other', hours: w.other_hours, color: OTHER_COLOR }] : []),
          ]
          const near = w.total_hours > NEAR_CAPACITY_HOURS
          return (
            <Box key={w.week_start} data-week={w.week_start}
              sx={{ display: 'grid', gridTemplateColumns: '68px 1fr 44px', alignItems: 'center', gap: 1, minHeight: 28 }}>
              <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                {formatWeekShort(w.week_start)}
              </Typography>
              <Box sx={{ position: 'relative', height: 18, borderRadius: 1, bgcolor: 'action.hover' }}>
                <Box sx={{ position: 'absolute', inset: 0, display: 'flex', ...motion('grow', i) }}>
                  {segments.map((s) => (
                    <Box key={s.key} sx={{
                      width: at(s.hours), bgcolor: s.color, borderRight: 1, borderColor: 'background.paper',
                      '&:first-of-type': { borderTopLeftRadius: 4, borderBottomLeftRadius: 4 },
                    }} />
                  ))}
                </Box>
                <Box sx={{ position: 'absolute', top: -2, bottom: -2, left: at(NEAR_CAPACITY_HOURS), borderLeft: 2, borderStyle: 'dashed', borderColor: 'text.secondary' }} />
                <Box sx={{ position: 'absolute', top: -3, bottom: -3, left: at(MAX_HOURS), borderLeft: 2, borderColor: 'text.primary' }} />
              </Box>
              <Typography variant="body2" sx={{ fontWeight: near ? 700 : 400, textAlign: 'right' }}>{w.total_hours} h</Typography>
              {near && (
                <Box sx={{ gridColumn: '2 / 4', mt: -0.5 }}>
                  <Chip size="small" label={`Over ${NEAR_CAPACITY_HOURS} h`} sx={toneSx('blocked')} />
                </Box>
              )}
            </Box>
          )
        })}
      </Box>
    </>
  )
}
