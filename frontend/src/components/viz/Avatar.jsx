import Box from '@mui/material/Box'
import { avatarColorSx, initials, initialsSx } from './vizMath'

const ringSx = (t) => ({ boxShadow: `0 0 0 2px ${(t.vars ?? t).palette.background.paper}` })

/**
 * A person's initials on their own colour (the same colour every time).
 * Beside their written name pass `decorative`, so the name is not read twice;
 * on its own it is an image named after the person.
 */
export default function Avatar({ name, size = 28, decorative = false }) {
  const a11y = decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name }
  return (
    <Box component="span" {...a11y} data-initials={initials(name)} sx={[avatarColorSx(name), initialsSx, {
      width: size, height: size, borderRadius: '50%', display: 'inline-grid', placeItems: 'center',
      fontSize: Math.round(size * 0.4), fontWeight: 700, lineHeight: 1, flexShrink: 0,
    }]} />
  )
}

/** A name with its avatar in front: <PersonName name="Ana Silva" /> or with a link as children. */
export function PersonName({ name, children, size = 26 }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, minWidth: 0, verticalAlign: 'middle' }}>
      <Avatar name={name} size={size} decorative />
      <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{children ?? name}</Box>
    </Box>
  )
}

/**
 * Up to `max` overlapping avatars and "+N" for the rest. The group is one image
 * named with everyone in it: "3 people: Ana Silva, Bo Chen, Eve Employee".
 */
export function AvatarStack({ names, max = 4, size = 28 }) {
  const shown = names.slice(0, max)
  const rest = names.length - shown.length
  const label = names.length === 0 ? 'No one'
    : `${names.length} ${names.length === 1 ? 'person' : 'people'}: ${names.join(', ')}`
  return (
    <Box role="img" aria-label={label} title={names.join(', ')}
      sx={{ display: 'inline-flex', alignItems: 'center', pl: 0.5, flexShrink: 0 }}>
      {shown.map((name) => (
        <Box key={name} sx={[{ ml: -0.5, borderRadius: '50%', display: 'flex' }, ringSx]}>
          <Avatar name={name} size={size} decorative />
        </Box>
      ))}
      {rest > 0 && (
        <Box aria-hidden="true" sx={[{
          ml: -0.5, width: size, height: size, borderRadius: '50%', display: 'grid', placeItems: 'center',
          fontSize: Math.round(size * 0.38), fontWeight: 700, bgcolor: 'action.selected', color: 'text.primary',
        }, ringSx]}>
          +{rest}
        </Box>
      )}
    </Box>
  )
}
