import Box from '@mui/material/Box'
import { sparklineSentence } from './vizMath'

/**
 * A small inline line chart. It is one image named with a sentence about the
 * range and trend, so a screen reader hears the meaning, not the points.
 *   <Sparkline values={[20, 20, 36]} what="Hours per week, next 3 weeks" unit=" h" limit={40} />
 * `limit` fixes the top of the scale and draws a dashed line there (e.g. 40 h).
 */
export default function Sparkline({ values, what, unit = '', limit, width = 120, height = 32 }) {
  const top = Math.max(limit ?? 0, ...values, 1)
  const step = values.length > 1 ? (width - 4) / (values.length - 1) : 0
  const y = (v) => height - 2 - (Math.max(v, 0) / top) * (height - 4)
  const points = values.map((v, i) => `${2 + i * step},${y(v)}`).join(' ')
  const last = values.length ? [2 + (values.length - 1) * step, y(values[values.length - 1])] : null
  return (
    <Box component="svg" role="img" aria-label={sparklineSentence(values, { what, unit })}
      viewBox={`0 0 ${width} ${height}`} width={width} height={height}
      sx={{ display: 'block', flexShrink: 0, overflow: 'visible', color: 'secondary.main' }}>
      {limit !== undefined && (
        <Box component="line" x1={0} x2={width} y1={y(limit)} y2={y(limit)}
          sx={{ stroke: 'currentColor', color: 'text.secondary', strokeWidth: 1, strokeDasharray: '3 3', opacity: 0.7 }} />
      )}
      {values.length > 1 && (
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth={2}
          strokeLinejoin="round" strokeLinecap="round" />
      )}
      {last && <circle cx={last[0]} cy={last[1]} r={2.5} fill="currentColor" />}
    </Box>
  )
}
