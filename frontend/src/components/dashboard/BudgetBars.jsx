import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import { Link as RouterLink } from 'react-router-dom'
import BudgetBar from '../BudgetBar'
import { Empty } from '../PageState'

/** Report 7 as one bar per project (components/BudgetBar.jsx). Labels say which measure is which. */
export default function BudgetBars({ projects }) {
  if (projects.length === 0) return <Empty>No projects to report on.</Empty>
  return (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Light bar: cost committed by assignments. Dark part: spent so far. The line marks the planned budget.
      </Typography>
      <Box component="ul" aria-label="Budget used by project" sx={{ listStyle: 'none', p: 0, m: 0, display: 'grid', gap: 2 }}>
        {projects.map((p, i) => (
          <li key={p.id}>
            <BudgetBar budget={p} index={i}
              name={<Link component={RouterLink} to={`/projects/${encodeURIComponent(p.id)}`}>{p.name}</Link>} />
          </li>
        ))}
      </Box>
    </>
  )
}
