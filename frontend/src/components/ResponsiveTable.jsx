import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import { useMediaQuery } from 'react-responsive'
import EmptyState from './EmptyState'
import { MUTED_ROW_SX } from '../theme'

/**
 * A table on wide screens, a list of cards on a phone.
 *   columns: [{ key, label, render(row), align?, primary? }]  (the primary column is the row header)
 * Columns with `hidden: true` are left out entirely (e.g. money for non-admins).
 * `accent(row)` may name a status tone (theme.js STATUS_COLORS) for a colour stripe
 * on the row's left edge; the row's own words still say the status.
 * `muted(row)` true greys a row out (e.g. an archived one; its own chip says "Archived").
 */
export default function ResponsiveTable({ label, columns, rows, empty, rowKey = (row) => row.id, accent, muted }) {
  const isPhone = useMediaQuery({ maxWidth: 599 })
  const shown = columns.filter((c) => !c.hidden)
  const primary = shown.find((c) => c.primary) ?? shown[0]

  const stripe = (row, side) => {
    const tone = accent?.(row)
    if (!tone) return {}
    return (theme) => ({ boxShadow: `inset ${side}px 0 0 ${(theme.vars ?? theme).palette.status[tone].fg}` })
  }
  const dim = (row) => (muted?.(row) ? MUTED_ROW_SX : {})

  if (rows.length === 0) {
    return <EmptyState compact title={empty} />
  }

  if (isPhone) {
    return (
      <Box component="ul" aria-label={label} sx={{ listStyle: 'none', p: 0, m: 0, display: 'grid', gap: 1.5 }}>
        {rows.map((row) => (
          <Paper component="li" key={rowKey(row)} variant="outlined" data-accent={accent?.(row)}
            data-muted={muted?.(row) || undefined} sx={[{ p: 2 }, stripe(row, 4), dim(row)]}>
            <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 600 }}>{primary.render(row)}</Typography>
            <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 2, rowGap: 0.5 }}>
              {shown.filter((c) => c !== primary).map((c) => (
                <Box key={c.key} sx={{ display: 'contents' }}>
                  <Typography component="dt" variant="body2" color="text.secondary">{c.label}</Typography>
                  <Typography component="dd" variant="body2" sx={{ m: 0 }}>{c.render(row)}</Typography>
                </Box>
              ))}
            </Box>
          </Paper>
        ))}
      </Box>
    )
  }

  return (
    <TableContainer component={Paper}>
      <Table aria-label={label}>
        <TableHead>
          <TableRow>
            {shown.map((c) => <TableCell key={c.key} align={c.align}>{c.label}</TableCell>)}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={rowKey(row)} hover data-accent={accent?.(row)} data-muted={muted?.(row) || undefined}
              sx={dim(row)}>
              {shown.map((c, i) => (c === primary ? (
                <TableCell key={c.key} component="th" scope="row" align={c.align} sx={i === 0 ? stripe(row, 4) : undefined}>
                  {c.render(row)}
                </TableCell>
              ) : (
                <TableCell key={c.key} align={c.align}>{c.render(row)}</TableCell>
              )))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
