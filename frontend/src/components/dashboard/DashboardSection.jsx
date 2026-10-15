import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Skeleton from '@mui/material/Skeleton'
import Typography from '@mui/material/Typography'
import { LoadError } from '../PageState'

/**
 * One dashboard card: a titled region with its own loading, error and ready
 * states, so a failing report only affects its own card.
 *   <DashboardSection title="At risk" result={atRisk} headingLevel="h3">{(data) => ...}</DashboardSection>
 * `heading` (optional) replaces the title text inside the heading, e.g. with a link.
 */
export default function DashboardSection({
  id, title, heading, result, headingLevel = 'h2', skeletonLines = 2, children, sx,
}) {
  const headingId = `${id}-heading`
  return (
    <Paper component="section" variant="outlined" aria-labelledby={headingId} sx={{ p: 2, minWidth: 0, ...sx }}>
      <Typography id={headingId} component={headingLevel} variant={headingLevel === 'h2' ? 'h6' : 'subtitle2'}
        color={headingLevel === 'h2' ? 'text.primary' : 'text.secondary'} gutterBottom>
        {heading ?? title}
      </Typography>
      {result.status === 'loading' && (
        <Box role="status" aria-busy="true" aria-label={`Loading ${title.toLowerCase()}`}>
          <Box aria-hidden="true">
            {Array.from({ length: skeletonLines }, (_, i) => (
              <Skeleton key={i} animation="wave" width={`${80 - i * 15}%`} height={i === 0 ? 40 : 24} />
            ))}
          </Box>
        </Box>
      )}
      {result.status === 'error' && <LoadError message={result.error} onRetry={result.reload} />}
      {result.status === 'ready' && children(result.data)}
    </Paper>
  )
}
