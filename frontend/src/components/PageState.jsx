import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'

/** A spinner that screen readers announce as `label` (e.g. "Loading projects"). */
export function Loading({ label }) {
  return (
    <Box role="status" aria-label={label} sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
      <CircularProgress />
    </Box>
  )
}

/** A friendly error with an optional "Try again" action. */
export function LoadError({ message, onRetry }) {
  return (
    <Alert severity="error" action={onRetry ? (
      <Button color="inherit" size="small" onClick={onRetry}>Try again</Button>
    ) : null}>
      {message}
    </Alert>
  )
}

/** "Nothing here yet" text. */
export function Empty({ children }) {
  return <Typography color="text.secondary" sx={{ py: 3 }}>{children}</Typography>
}

/**
 * The three states of a useLoad() result in one place:
 *   <LoadState result={result} label="Loading teams">{(data) => ...}</LoadState>
 */
export function LoadState({ result, label, children }) {
  if (result.status === 'loading') return <Loading label={label} />
  if (result.status === 'error') return <LoadError message={result.error} onRetry={result.reload} />
  return children(result.data)
}
