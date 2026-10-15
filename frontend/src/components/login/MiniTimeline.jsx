import Box from '@mui/material/Box'
import { keyframes } from '@mui/material/styles'
import { usePrefersReducedMotion } from '../motion/motion'

// The login page's one decoration: a tiny week timeline in the app's own
// language (bars on a week grid, a dependency arrow, the dashed 40 h line and
// one bar in the at-risk amber). It shows no names, dates or amounts, so it
// can't be mistaken for real data, and it is hidden from screen readers.

const draw = keyframes`
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
`
const appear = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`

const WEEKS = 6
const W = 360
const H = 200
const COL = W / WEEKS
const ROW = 34
const TOP = 52

// [start week, length in weeks, row, colour]
const BARS = [
  [0, 2, 0, '#5CC8D3'],
  [2.4, 2.2, 1, '#8AB8F2'],
  [1, 3, 2, '#C9D6E5'],
  [3.5, 2, 3, '#FFC861'], // at risk: the same amber as the app's warnings
]

export default function MiniTimeline() {
  const reduced = usePrefersReducedMotion()
  const barY = (row) => TOP + row * ROW
  const [a, b] = [BARS[0], BARS[1]]
  // From under the end of the first bar down into the start of the second (it depends on the first).
  const arrowFrom = [(a[0] + a[1]) * COL - 10, barY(a[2]) + 18]
  const arrowTo = [b[0] * COL - 2, barY(b[2]) + 9]
  return (
    <Box component="svg" aria-hidden="true" viewBox={`0 0 ${W} ${H}`} data-testid="mini-timeline"
      sx={{ width: '100%', maxWidth: 420, height: 'auto', display: 'block', overflow: 'visible' }}>
      <defs>
        <marker id="login-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="#D6E1EE" />
        </marker>
      </defs>
      {Array.from({ length: WEEKS + 1 }, (_, i) => (
        <line key={i} x1={i * COL} x2={i * COL} y1={TOP - 14} y2={H - 6} stroke="#D6E1EE" strokeOpacity="0.14" />
      ))}
      {Array.from({ length: WEEKS }, (_, i) => (
        <rect key={i} x={i * COL + COL / 2 - 10} y={TOP - 30} width="20" height="4" rx="2" fill="#D6E1EE" opacity="0.25" />
      ))}
      <line x1="0" x2={W} y1={TOP - 6} y2={TOP - 6} stroke="#FFC861" strokeOpacity="0.7" strokeDasharray="5 5" />
      <text x={W} y={TOP - 11} textAnchor="end" fill="#FFC861" fillOpacity="0.85" fontSize="10" fontWeight="600">40 h</text>
      {BARS.map(([start, length, row, color], i) => (
        <Box component="rect" key={i} x={start * COL + 2} y={barY(row)} width={length * COL - 4} height="18" rx="5"
          fill={color} sx={reduced ? {} : {
            transformBox: 'fill-box', transformOrigin: 'left center',
            animation: `${draw} 420ms cubic-bezier(.2,.7,.2,1) ${150 + i * 110}ms both`,
          }} />
      ))}
      <Box component="path" d={`M${arrowFrom[0]},${arrowFrom[1]} C${arrowFrom[0]},${arrowTo[1]} ${arrowFrom[0]},${arrowTo[1]} ${arrowTo[0]},${arrowTo[1]}`}
        fill="none" stroke="#D6E1EE" strokeWidth="1.5" markerEnd="url(#login-arrow)"
        sx={reduced ? {} : { animation: `${appear} 300ms ease-out 650ms both` }} />
    </Box>
  )
}
