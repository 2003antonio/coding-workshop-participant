import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { DELIVERABLE_STATUS, formatDate } from '../../pages/format'
import StatusChip from '../StatusChip'
import {
  axisTicks, barPosition, dayNumber, dayToDate, flagsFor, percentAt, sentenceFor, spanOf,
} from './timelineMath'

const ROW = 44 // px per deliverable; also a comfortable tap height
const LIST_LABEL = 'Deliverables in dependency order'

/** Off screen but read by screen readers. */
const visuallyHidden = {
  position: 'absolute', width: 1, height: 1, p: 0, m: '-1px', overflow: 'hidden',
  clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
}

/** Bar fill per status. Overdue and blocked add a border or stripes AND a text chip. */
const FILL = { not_started: 'grey.500', in_progress: 'primary.main', done: 'success.main' }
const STRIPES = 'repeating-linear-gradient(45deg, transparent 0 5px, rgba(0,0,0,0.35) 5px 9px)'

function Flags({ flags }) {
  return (
    <>
      {flags.overdue && <Chip size="small" color="error" label="Overdue" />}
      {flags.blocked && <Chip size="small" color="warning" label="Blocked" />}
    </>
  )
}

function LongestChain({ chain, names }) {
  if (!chain.longest_chain.length) return null
  return (
    <Typography sx={{ mb: 2 }}>
      <strong>Longest chain:</strong> {chain.longest_chain.map((id) => names.get(id)).join(' → ')}
    </Typography>
  )
}

/** Phone: the same information as an ordered list of cards, no chart. */
function PhoneList({ rows, names }) {
  return (
    <Box component="ol" aria-label={LIST_LABEL} sx={{ listStyle: 'none', p: 0, m: 0, display: 'grid', gap: 1.5 }}>
      {rows.map(({ node, flags }, i) => (
        <Paper component="li" key={node.id} variant="outlined" sx={{ p: 2 }}>
          <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 600 }}>{i + 1}. {node.name}</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, my: 0.5 }}>
            <StatusChip status={node.status} />
            <Flags flags={flags} />
            {flags.onChain && <Chip size="small" variant="outlined" label="Longest chain" />}
          </Box>
          <Typography variant="body2">{formatDate(node.start_date)} – {formatDate(node.due_date)}</Typography>
          {flags.waitsFor.length > 0 && (
            <Typography variant="body2" color="text.secondary">
              Waits for {flags.waitsFor.map((id) => names.get(id) ?? 'another deliverable').join(' and ')}
            </Typography>
          )}
        </Paper>
      ))}
    </Box>
  )
}

function Legend() {
  const swatch = (sx) => <Box component="span" aria-hidden="true" sx={{ display: 'inline-block', width: 18, height: 12, borderRadius: 0.5, ...sx }} />
  const items = [
    ...Object.entries(FILL).map(([status, color]) => [DELIVERABLE_STATUS[status], { bgcolor: color }]),
    ['Overdue (red border)', { border: 2, borderColor: 'error.main' }],
    ['Blocked (striped)', { bgcolor: 'grey.500', backgroundImage: STRIPES }],
    ['Longest chain (outlined)', { bgcolor: 'grey.500', boxShadow: (t) => `0 0 0 2px ${t.palette.text.primary}` }],
  ]
  return (
    <Box component="ul" aria-label="Legend" sx={{ listStyle: 'none', p: 0, m: 0, mt: 2, display: 'flex', flexWrap: 'wrap', gap: 2 }}>
      {items.map(([label, sx]) => (
        <Typography component="li" variant="body2" key={label} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
          {swatch(sx)}{label}
        </Typography>
      ))}
    </Box>
  )
}

/** Desktop and tablet: a Gantt-style chart on a shared date axis. */
function Chart({ chain, rows, today, labelWidth }) {
  const span = spanOf(rows.map((r) => r.node))
  const ticks = axisTicks(span)
  const rowOf = new Map(rows.map((r, i) => [r.node.id, i]))
  const position = new Map(rows.map((r) => [r.node.id, barPosition(r.node, span)]))
  const chainSteps = new Set(chain.longest_chain.slice(1).map((id, i) => `${chain.longest_chain[i]}>${id}`))
  const todayAt = percentAt(dayNumber(today), span)
  const height = rows.length * ROW

  return (
    <Box role="group" aria-label="Dependency timeline"
      sx={{ display: 'grid', gridTemplateColumns: `${labelWidth}px 1fr`, columnGap: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'end' }}>
        {formatDate(dayToDate(span.start))} – {formatDate(dayToDate(span.end - 1))}
      </Typography>
      <Box aria-hidden="true" sx={{ position: 'relative', height: 24, borderBottom: 1, borderColor: 'divider' }}>
        {ticks.map((t) => (
          <Typography key={t.date} variant="caption" color="text.secondary" sx={{
            position: 'absolute', left: `${t.left}%`, bottom: 2, whiteSpace: 'nowrap', pl: 0.5,
            transform: t.left > 85 ? 'translateX(-100%)' : 'none',
          }}>
            {t.label}
          </Typography>
        ))}
      </Box>

      <Box>
        {rows.map(({ node, flags }) => (
          <Box key={node.id} sx={{ height: ROW, display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
            <Typography variant="body2" noWrap title={node.name} sx={{ flex: 1, minWidth: 0, fontWeight: flags.onChain ? 600 : 400 }}>
              {node.name}
            </Typography>
            <Flags flags={flags} />
          </Box>
        ))}
      </Box>
      <Box sx={{ position: 'relative', height }}>
        {ticks.map((t) => (
          <Box key={t.date} aria-hidden="true" sx={{
            position: 'absolute', top: 0, bottom: 0, left: `${t.left}%`, borderLeft: '1px dashed', borderColor: 'divider',
          }} />
        ))}
        {todayAt >= 0 && todayAt <= 100 && (
          <Box aria-hidden="true" data-testid="today-line" sx={{
            position: 'absolute', top: 0, bottom: 0, left: `${todayAt}%`, borderLeft: 2, borderColor: 'warning.main',
          }} />
        )}
        <Box component="svg" aria-hidden="true" focusable="false" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none"
          sx={{ position: 'absolute', inset: 0, width: '100%', height, overflow: 'visible', pointerEvents: 'none' }}>
          {chain.edges.filter((e) => rowOf.has(e.from) && rowOf.has(e.to)).map((e) => {
            const from = position.get(e.from)
            const x1 = from.left + from.width
            const x2 = position.get(e.to).left
            const y1 = rowOf.get(e.from) * ROW + ROW / 2
            const y2 = rowOf.get(e.to) * ROW + ROW / 2
            const bend = Math.min(x1 + 1, 100)
            const onChain = chainSteps.has(`${e.from}>${e.to}`)
            return (
              <Box component="path" key={`${e.from}>${e.to}`} data-edge={`${e.from}>${e.to}`}
                d={`M ${x1} ${y1} H ${bend} V ${y2} H ${x2}`} fill="none" vectorEffect="non-scaling-stroke"
                strokeWidth={onChain ? 2.5 : 1.5}
                sx={{ stroke: (t) => (onChain ? t.palette.text.primary : t.palette.text.disabled) }} />
            )
          })}
        </Box>
        {rows.map(({ node, flags, sentence }, i) => {
          const { left, width } = position.get(node.id)
          return (
            <Tooltip key={node.id} arrow title={(
              <>
                <strong>{node.name}</strong><br />
                {formatDate(node.start_date)} – {formatDate(node.due_date)}<br />
                {DELIVERABLE_STATUS[node.status] ?? node.status}
                {flags.overdue ? ', overdue' : ''}{flags.blocked ? ', blocked' : ''}
              </>
            )}>
              <Box role="img" tabIndex={0} aria-label={sentence} data-bar={node.id}
                style={{ left: `${left}%`, width: `max(${width}%, 6px)`, top: i * ROW + 10 }}
                sx={{
                  position: 'absolute', height: ROW - 20, borderRadius: 1, bgcolor: FILL[node.status] ?? 'grey.500',
                  backgroundImage: flags.blocked ? STRIPES : 'none',
                  border: flags.overdue ? 2 : 0, borderColor: 'error.main',
                  boxShadow: flags.onChain ? (t) => `0 0 0 2px ${t.palette.text.primary}` : 'none',
                  '&:focus-visible': { outline: 3, outlineColor: 'primary.main', outlineOffset: 3 },
                }} />
            </Tooltip>
          )
        })}
      </Box>
    </Box>
  )
}

/**
 * The dependency-chain report of one project (§8 report 6) as a timeline: one
 * row per deliverable in the server's order, bars by date, lines from each
 * dependency's end to the dependent's start, the longest chain outlined. A
 * visually hidden ordered list says the same in words. On a phone: the list only.
 */
export default function DependencyTimeline({ chain, today, isPhone = false, labelWidth = 220 }) {
  const byId = new Map(chain.nodes.map((n) => [n.id, n]))
  const names = new Map(chain.nodes.map((n) => [n.id, n.name]))
  const flags = flagsFor(chain, today)
  const order = chain.order.filter((id) => byId.has(id))
  const rows = order.map((id) => {
    const node = byId.get(id)
    return { node, flags: flags.get(id), sentence: sentenceFor(node, flags.get(id), names) }
  })

  return (
    <Box>
      <LongestChain chain={chain} names={names} />
      {isPhone ? <PhoneList rows={rows} names={names} /> : (
        <>
          <Chart chain={chain} rows={rows} today={today} labelWidth={labelWidth} />
          <Box component="ol" aria-label={LIST_LABEL} sx={visuallyHidden}>
            {rows.map((r) => <li key={r.node.id}>{r.sentence}</li>)}
          </Box>
          <Legend />
        </>
      )}
    </Box>
  )
}
