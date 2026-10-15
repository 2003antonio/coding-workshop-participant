import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { useBreakpoint } from '../hooks/useBreakpoint'

/**
 * The top of every page: the page's only h1, an optional line under it, and
 * optional buttons on the right (they wrap below the title on a phone).
 *   <PageHeader title="Projects" subtitle="Everything you can see." actions={<Button>New project</Button>} />
 * `before` goes above the title (e.g. a "← All projects" link), `after` under the subtitle,
 * `icon` (decorative, e.g. a ProjectTile) to the left of the title.
 */
export default function PageHeader({ title, subtitle, actions, before, after, icon }) {
  const { isPhone } = useBreakpoint()
  return (
    <Box sx={{ mb: 3 }}>
      {before}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
        <Box sx={{ flexGrow: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 2 }}>
          {icon}
          <Box sx={{ minWidth: 0 }}>
            <Typography variant={isPhone ? 'h5' : 'h4'} component="h1" sx={{ overflowWrap: 'anywhere' }}>
              {title}
            </Typography>
            {subtitle && <Typography color="text.secondary" sx={{ mt: 0.5 }}>{subtitle}</Typography>}
          </Box>
        </Box>
        {actions && <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>{actions}</Box>}
      </Box>
      {after}
    </Box>
  )
}
