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

/**
 * A table on wide screens, a list of cards on a phone.
 *   columns: [{ key, label, render(row), align?, primary? }]  (the primary column is the row header)
 * Columns with `hidden: true` are left out entirely (e.g. money for non-admins).
 */
export default function ResponsiveTable({ label, columns, rows, empty, rowKey = (row) => row.id }) {
  const isPhone = useMediaQuery({ maxWidth: 599 })
  const shown = columns.filter((c) => !c.hidden)
  const primary = shown.find((c) => c.primary) ?? shown[0]

  if (rows.length === 0) {
    return <Typography color="text.secondary" sx={{ py: 3 }}>{empty}</Typography>
  }

  if (isPhone) {
    return (
      <Box component="ul" aria-label={label} sx={{ listStyle: 'none', p: 0, m: 0, display: 'grid', gap: 1.5 }}>
        {rows.map((row) => (
          <Paper component="li" key={rowKey(row)} variant="outlined" sx={{ p: 2 }}>
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
            <TableRow key={rowKey(row)} hover>
              {shown.map((c) => (c === primary ? (
                <TableCell key={c.key} component="th" scope="row" align={c.align}>{c.render(row)}</TableCell>
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
