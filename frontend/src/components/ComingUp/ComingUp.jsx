import EventOutlined from '@mui/icons-material/EventOutlined'
import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { Link as RouterLink } from 'react-router-dom'
import EmptyState from '../EmptyState'
import { localToday } from '../home/homeMath'
import DueChip from '../viz/DueChip'
import { comingUp } from './comingUpMath'

const projectPath = (id) => `/projects/${encodeURIComponent(id)}`

/**
 * "Coming up": the deliverables that are overdue or due within `days`, soonest
 * first (at most six), each a link to its project with a DueChip. Used on an
 * employee's Home (their projects) and on admin and manager Home (what they see).
 *   <ComingUp deliverables={report.deliverables} days={14} empty="Nothing due in the next 14 days."
 *     footer={<Link to="/reports?tab=deliverables">View all deliverables</Link>} />
 */
export default function ComingUp({ deliverables, days, empty, footer, title = 'Coming up', today = localToday() }) {
  const rows = comingUp(deliverables, today, days)
  return (
    <Paper component="section" variant="outlined" aria-labelledby="coming-up-heading"
      sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <Typography id="coming-up-heading" component="h2" variant="h6">{title}</Typography>
      {rows.length === 0 ? (
        <EmptyState compact icon={EventOutlined} title={empty} />
      ) : (
        <Box component="ul" aria-label={title} sx={{ listStyle: 'none', p: 0, m: 0, display: 'grid', gap: 0.5 }}>
          {rows.map((d) => (
            <Box component="li" key={d.id} sx={{
              display: 'flex', alignItems: 'center', gap: 1, py: 0.75, minWidth: 0,
              borderBottom: 1, borderColor: 'divider', '&:last-of-type': { borderBottom: 0 },
            }}>
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Link component={RouterLink} to={projectPath(d.project.id)} sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                  {d.name}
                </Link>
                <Typography variant="body2" color="text.secondary" noWrap>{d.project.name}</Typography>
              </Box>
              <DueChip due={d.due_date} today={today} />
            </Box>
          ))}
        </Box>
      )}
      {footer && <Box sx={{ mt: 'auto', pt: 0.5 }}>{footer}</Box>}
    </Paper>
  )
}
