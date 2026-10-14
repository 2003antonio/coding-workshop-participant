import { useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { toneSx } from '../../theme'
import { formatWeek, formatWeekShort } from '../../pages/format'
import { HEAT_LEVELS, breakdown, cellLabel, heatLevel } from './heatScale'

/** Fill and text per band; every pair is a theme token pair that passes 4.5:1. */
const LEVEL_SX = {
  empty: { color: 'text.secondary' },
  low: toneSx('in_progress'),
  mid: { bgcolor: 'primary.main', color: 'primary.contrastText' },
  high: toneSx('blocked'),
  full: toneSx('over_budget'),
}

const MOVES = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }

/** The colour key, with each band's range in words. */
export function HeatLegend() {
  return (
    <Box component="ul" aria-label="Legend" sx={{ listStyle: 'none', p: 0, m: 0, mt: 1.5, display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
      {HEAT_LEVELS.map((level) => (
        <Typography component="li" variant="body2" key={level.key} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
          <Box component="span" aria-hidden="true" sx={[{
            width: 18, height: 14, borderRadius: 0.5, border: 1, borderColor: 'divider',
          }, LEVEL_SX[level.key]]} />
          {level.label}
        </Typography>
      ))}
    </Box>
  )
}

/**
 * People by weeks: each cell coloured by total hours AND showing the number.
 * Hover or focus a cell for the projects behind it; arrow keys move between
 * cells (one Tab stop for the whole grid). It is a real table, so screen
 * readers announce the person and week for every cell. The name column stays
 * put while the weeks scroll sideways on narrow screens.
 */
export default function CapacityHeatmap({ weeks, people, isPhone = false }) {
  const [active, setActive] = useState({ row: 0, col: 0 })
  const grid = useRef(null)

  function move(event) {
    const step = MOVES[event.key]
    if (!step) return
    event.preventDefault()
    const row = Math.min(Math.max(active.row + step[0], 0), people.length - 1)
    const col = Math.min(Math.max(active.col + step[1], 0), weeks.length - 1)
    setActive({ row, col })
    grid.current?.querySelector(`[data-cell="${row}-${col}"]`)?.focus()
  }

  const sticky = {
    position: 'sticky', left: 0, zIndex: 1, bgcolor: 'background.paper',
    maxWidth: isPhone ? 112 : 200, borderRight: 1, borderColor: 'divider',
  }

  return (
    <TableContainer component={Paper} variant="outlined" ref={grid} onKeyDown={move}>
      <Table size="small" aria-label="Resource allocation" sx={{ '& td, & th': { px: 1 } }}>
        <TableHead>
          <TableRow>
            <TableCell component="th" scope="col" sx={{ ...sticky, zIndex: 2 }}>Person</TableCell>
            {weeks.map((week) => (
              <TableCell key={week} component="th" scope="col" align="center" sx={{ whiteSpace: 'nowrap' }}>
                <abbr title={formatWeek(week)} style={{ textDecoration: 'none' }}>{formatWeekShort(week)}</abbr>
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {people.map((person, row) => (
            <TableRow key={person.id}>
              <TableCell component="th" scope="row" sx={sticky}>{person.name}</TableCell>
              {weeks.map((week, col) => {
                const w = person.weeks[col] ?? { week_start: week, total_hours: 0, projects: [], other_hours: 0 }
                const hours = w.total_hours
                const lines = breakdown(w)
                const focusable = row === active.row && col === active.col
                return (
                  <Tooltip key={week} describeChild arrow
                    title={lines.length ? lines.map((l) => <div key={l}>{l}</div>) : 'No hours this week'}>
                    <TableCell align="center" data-cell={`${row}-${col}`} data-level={heatLevel(hours)}
                      tabIndex={focusable ? 0 : -1} aria-label={cellLabel(person.name, week, hours)}
                      onFocus={() => setActive({ row, col })}
                      sx={[{
                        minWidth: 56, fontVariantNumeric: 'tabular-nums', fontWeight: hours > 32 ? 700 : 400,
                        borderLeft: 1, borderColor: 'divider',
                        '&:focus-visible': { outline: 3, outlineColor: 'primary.main', outlineOffset: -3 },
                      }, LEVEL_SX[heatLevel(hours)]]}>
                      {hours} h
                    </TableCell>
                  </Tooltip>
                )
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
