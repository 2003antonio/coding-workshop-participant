import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { formatMoney, hiddenMessage } from '../pages/format'

/**
 * Money totals, or why they are hidden. `figures` is [[label, amount], ...];
 * when `hiddenReason` is set (or any amount is null) no number is shown at all.
 */
export default function BudgetPanel({ title, figures, hiddenReason, footnote, children }) {
  const hidden = Boolean(hiddenReason) || figures.some(([, amount]) => amount === null || amount === undefined)
  return (
    <Paper component="section" aria-label={title} variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h6" component="h2" gutterBottom>{title}</Typography>
      {hidden ? (
        <Alert severity="info">{hiddenMessage(hiddenReason)}</Alert>
      ) : (
        <Box component="dl" sx={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 2, m: 0,
        }}>
          {figures.map(([label, amount]) => (
            <Box key={label}>
              <Typography component="dt" variant="body2" color="text.secondary">{label}</Typography>
              <Typography component="dd" variant="h6" sx={{ m: 0 }}>{formatMoney(amount)}</Typography>
            </Box>
          ))}
        </Box>
      )}
      {footnote && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{footnote}</Typography>}
      {children}
    </Paper>
  )
}
