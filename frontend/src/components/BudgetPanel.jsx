import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { formatMoney, hiddenMessage } from '../pages/format'

/** A label/value grid. Values are money unless a figure gives its own text. */
function Figures({ figures }) {
  return (
    <Box component="dl" sx={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 2, m: 0,
    }}>
      {figures.map(([label, amount, text]) => (
        <Box key={label}>
          <Typography component="dt" variant="body2" color="text.secondary">{label}</Typography>
          <Typography component="dd" variant="h6" sx={{ m: 0 }}>{text ?? formatMoney(amount)}</Typography>
        </Box>
      ))}
    </Box>
  )
}

/**
 * Money totals, or why they are hidden. `figures` is [[label, amount, text?], ...];
 * when `hiddenReason` is set (or any money amount is null) none of them is shown.
 * `summary` (e.g. a typed planned budget, which is not pay data) and `status`
 * (e.g. the over-budget flag) are shown above and below the figures.
 */
export default function BudgetPanel({ title, summary, figures, status, hiddenReason, footnote, children }) {
  const hidden = Boolean(hiddenReason)
    || figures.some(([, amount, text]) => text === undefined && (amount === null || amount === undefined))
  return (
    <Paper component="section" aria-label={title} variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h6" component="h2" gutterBottom>{title}</Typography>
      {summary && <Box sx={{ mb: 2 }}><Figures figures={summary} /></Box>}
      {hidden ? (
        <Alert severity="info">{hiddenMessage(hiddenReason)}</Alert>
      ) : (
        <>
          <Figures figures={figures} />
          {status && <Box sx={{ mt: 2 }}>{status}</Box>}
        </>
      )}
      {footnote && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{footnote}</Typography>}
      {children}
    </Paper>
  )
}
