import Box from '@mui/material/Box'
import { avatarColorSx, initials } from './vizMath'

/**
 * A small rounded square with a project's initials on its own colour. It always
 * sits beside the project's name, so it is hidden from screen readers.
 */
export default function ProjectTile({ name, size = 28 }) {
  return (
    <Box aria-hidden="true" data-testid="project-tile" sx={[avatarColorSx(name), {
      width: size, height: size, borderRadius: size >= 40 ? '10px' : '7px', flexShrink: 0,
      display: 'inline-grid', placeItems: 'center', fontSize: Math.round(size * 0.4), fontWeight: 700, lineHeight: 1,
    }]}>
      {initials(name)}
    </Box>
  )
}

/** A project's tile and name on one line: <ProjectName name="Billing v2"><Link ...>Billing v2</Link></ProjectName>. */
export function ProjectName({ name, children, size = 24 }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, minWidth: 0, verticalAlign: 'middle' }}>
      <ProjectTile name={name} size={size} />
      <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{children ?? name}</Box>
    </Box>
  )
}
