import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Container from '@mui/material/Container'
import Paper from '@mui/material/Paper'
import Skeleton from '@mui/material/Skeleton'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

/** A spinner that screen readers announce as `label` (e.g. "Loading projects"). */
export function Loading({ label }) {
  return (
    <Box role="status" aria-label={label} sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
      <CircularProgress />
    </Box>
  )
}

// Grey placeholder shapes in the layout of the data to come. They shimmer
// ("wave"); theme.js stops the shimmer when the computer asks for reduced motion.
const line = (width, height) => <Skeleton animation="wave" width={width} height={height} />
const block = (height, sx) => <Skeleton animation="wave" variant="rounded" height={height} sx={sx} />

const SHAPES = {
  cards: () => (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(auto-fill, minmax(240px, 1fr))' } }}>
      {[0, 1, 2].map((i) => (
        <Paper key={i} variant="outlined" sx={{ p: 2 }}>
          {line('60%', 28)}
          {line('40%')}
          {block(48, { mt: 1 })}
        </Paper>
      ))}
    </Box>
  ),
  table: () => (
    <Paper variant="outlined" sx={{ p: 2 }}>
      {block(32, { mb: 1.5 })}
      {[0, 1, 2, 3, 4].map((i) => <Box key={i} sx={{ py: 0.5 }}>{line(`${90 - i * 6}%`, 28)}</Box>)}
    </Paper>
  ),
  list: () => (
    <Stack spacing={1.5}>
      {[0, 1, 2, 3].map((i) => (
        <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Skeleton animation="wave" variant="circular" width={36} height={36} />
          <Box sx={{ flexGrow: 1 }}>{line('50%')}{line('30%')}</Box>
        </Box>
      ))}
    </Stack>
  ),
  chart: () => (
    <Paper variant="outlined" sx={{ p: 2 }}>
      {line('35%', 28)}
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1.5, height: 180, mt: 1 }}>
        {[60, 85, 40, 100, 70, 55].map((h, i) => (
          <Skeleton key={i} animation="wave" variant="rounded" height={`${h}%`} sx={{ flex: 1 }} />
        ))}
      </Box>
    </Paper>
  ),
  detail: () => (
    <>
      {line('45%', 44)}
      {line('30%')}
      <Box sx={{ display: 'flex', gap: 2, my: 2 }}>{[0, 1, 2].map((i) => <Box key={i}>{line(96, 32)}</Box>)}</Box>
      {block(220)}
    </>
  ),
}

/**
 * Placeholder shapes while data loads, announced as `label`:
 *   <LoadingSkeleton variant="table" label="Loading projects" />
 * variant: cards | table | list | chart | detail. `label` must start with
 * "Loading" (E2E tests wait for every "Loading ..." status to go away).
 */
export function LoadingSkeleton({ variant = 'list', label = 'Loading' }) {
  const Shape = SHAPES[variant] ?? SHAPES.list
  return (
    <Box role="status" aria-busy="true" aria-label={label} sx={{ py: 1 }}>
      <Box aria-hidden="true"><Shape /></Box>
    </Box>
  )
}

/** Whole-page placeholder while a page's code downloads (routes.jsx Suspense fallback). */
export function PageSkeleton() {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <Container maxWidth="lg" sx={{ py: 6 }}>
        <LoadingSkeleton variant="detail" label="Loading page" />
      </Container>
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
 *   <LoadState result={result} label="Loading teams" skeleton="table">{(data) => ...}</LoadState>
 * `skeleton` (optional) picks a LoadingSkeleton variant; without it, a spinner.
 */
export function LoadState({ result, label, skeleton, children }) {
  if (result.status === 'loading') {
    return skeleton ? <LoadingSkeleton variant={skeleton} label={label} /> : <Loading label={label} />
  }
  if (result.status === 'error') return <LoadError message={result.error} onRetry={result.reload} />
  return children(result.data)
}
