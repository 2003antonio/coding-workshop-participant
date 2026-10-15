import ArrowBackOutlined from '@mui/icons-material/ArrowBackOutlined'
import Box from '@mui/material/Box'
import Breadcrumbs from '@mui/material/Breadcrumbs'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import { Link as RouterLink } from 'react-router-dom'
import { useBreakpoint } from '../hooks/useBreakpoint'

/**
 * The top of every page: the page's only h1, an optional line under it, and
 * optional buttons on the right (they wrap below the title on a phone).
 *   <PageHeader title="Projects" subtitle="Everything you can see." actions={<Button>New project</Button>} />
 * `breadcrumbs` ([{ label, to }, ..., { label }]) go above the title in a "Breadcrumb" nav: earlier
 * crumbs are links, the last is plain text with aria-current="page". On a phone only the parent
 * shows, as "← <parent>". `before` goes above the title too, `after` under the subtitle,
 * `icon` (decorative, e.g. a ProjectTile) to the left of the title.
 */
function Crumbs({ items, phone }) {
  const parent = items.at(-2)
  if (phone) {
    return parent ? (
      <Box component="nav" aria-label="Breadcrumb" sx={{ mb: 1.5 }}>
        <Link component={RouterLink} to={parent.to} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minHeight: 44 }}>
          <ArrowBackOutlined fontSize="small" aria-hidden="true" />{parent.label}
        </Link>
      </Box>
    ) : null
  }
  return (
    <Breadcrumbs aria-label="Breadcrumb" sx={{ mb: 1.5, '& .MuiBreadcrumbs-ol': { flexWrap: 'wrap' } }}>
      {items.map((crumb, i) => (i < items.length - 1 ? (
        <Link key={crumb.label} component={RouterLink} to={crumb.to} underline="hover" color="text.secondary">
          {crumb.label}
        </Link>
      ) : (
        <Typography key={crumb.label} color="text.primary" aria-current="page" sx={{ overflowWrap: 'anywhere' }}>
          {crumb.label}
        </Typography>
      )))}
    </Breadcrumbs>
  )
}

export default function PageHeader({ title, subtitle, actions, before, after, icon, breadcrumbs }) {
  const { isPhone } = useBreakpoint()
  return (
    <Box sx={{ mb: 3 }}>
      {breadcrumbs && <Crumbs items={breadcrumbs} phone={isPhone} />}
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
