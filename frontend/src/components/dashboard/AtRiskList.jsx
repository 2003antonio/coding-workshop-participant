import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import { Link as RouterLink } from 'react-router-dom'
import { toneSx } from '../../theme'
import { useMotion } from '../motion/motion'
import { Empty } from '../PageState'
import { riskChip } from './riskReasons'

/** The reasons as chips with an icon, in the status colours; the icon picks up the chip's text colour. */
export function RiskChips({ name, reasons }) {
  return (
    <Box component="ul" aria-label={`Why ${name} is at risk`}
      sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, listStyle: 'none', p: 0, m: 0, mt: 1 }}>
      {reasons.map((reason) => {
        const { label, icon: Icon, tone } = riskChip(reason)
        return (
          <li key={reason}>
            <Chip size="small" label={label} icon={<Icon fontSize="small" />}
              sx={[toneSx(tone), { '& .MuiChip-icon': { color: 'inherit' } }]} />
          </li>
        )
      })}
    </Box>
  )
}

/** Report 2 as a list: project (links to it), team, and why it is at risk. */
export default function AtRiskList({ projects }) {
  const motion = useMotion()
  if (projects.length === 0) return <Empty>No projects are at risk right now.</Empty>
  return (
    <Box component="ul" aria-label="At-risk projects" sx={{ listStyle: 'none', p: 0, m: 0, display: 'grid', gap: 2 }}>
      {projects.map((p, i) => (
        <Box component="li" key={p.id} sx={motion('enter', i)}>
          <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 600 }}>
            <Link component={RouterLink} to={`/projects/${encodeURIComponent(p.id)}`}>{p.name}</Link>
          </Typography>
          <Typography variant="body2" color="text.secondary">{p.team?.name}</Typography>
          <RiskChips name={p.name} reasons={p.reasons} />
          <Link component={RouterLink} to={`/projects/${encodeURIComponent(p.id)}`} aria-label={`View project ${p.name}`}
            variant="body2" sx={{ display: 'inline-block', mt: 1, fontWeight: 600 }}>
            View project →
          </Link>
        </Box>
      ))}
    </Box>
  )
}
