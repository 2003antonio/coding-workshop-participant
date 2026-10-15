import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import { Link as RouterLink } from 'react-router-dom'
import DashboardSection from './DashboardSection'

// The title is the link; its ::after covers the card so the whole card is clickable,
// and the card shows the focus ring while the link has keyboard focus.
const stretchedLinkSx = {
  '&::after': { content: '""', position: 'absolute', inset: 0, borderRadius: 'inherit' },
  '&:focus-visible': { outline: 'none' },
}
const linkCardSx = {
  position: 'relative', height: '100%', display: 'flex', flexDirection: 'column',
  transition: 'border-color 150ms, box-shadow 150ms',
  '&:hover': { borderColor: 'primary.main', boxShadow: 2 },
  '&:has(a:focus-visible)': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
}

/**
 * A number card. `count(data)` returns { value, note? }: value is a number or a
 * word such as "Hidden" (never a made-up 0), note is one line of context.
 * With `to`, the whole card links there (named by its title).
 */
export default function StatCard({ id, title, result, count, to }) {
  const heading = to
    ? <Link component={RouterLink} to={to} color="inherit" underline="hover" sx={stretchedLinkSx}>{title}</Link>
    : title
  return (
    <DashboardSection id={id} title={title} heading={heading} result={result} headingLevel="h3"
      sx={to ? linkCardSx : { height: '100%' }}>
      {(data) => {
        const { value, note } = count(data)
        return (
          <>
            <Typography component="p" variant="h4" sx={{ fontWeight: 700, lineHeight: 1.2, mt: 'auto' }}>{value}</Typography>
            {note && <Typography variant="body2" color="text.secondary">{note}</Typography>}
          </>
        )
      }}
    </DashboardSection>
  )
}
