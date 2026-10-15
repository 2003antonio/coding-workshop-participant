// Click-to-reveal for an individual's pay (admin only): a shoulder-surfing guard.
// While masked, the real figure is not in the page at all (not even hidden), so
// it cannot be read off the screen or copied. It re-masks after REVEAL_MS and
// whenever the component unmounts (leaving the page or closing a dialog).
// State lives in memory only. This is a display guard: the API still sends the
// figure to an admin, and the server never sends it to anyone else.
import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined'
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import { MASK, useReveal } from './reveal'

/** The eye button: "Show salary for Ana Silva" / "Hide salary for Ana Silva". */
export function RevealButton({ shown, onToggle, what, name }) {
  const label = `${shown ? 'Hide' : 'Show'} ${what} for ${name}`
  return (
    <Tooltip title={label}>
      <IconButton size="small" aria-label={label} aria-pressed={shown} onClick={onToggle}
        sx={{ width: 32, height: 32 }}>
        {shown ? <VisibilityOffOutlined fontSize="small" /> : <VisibilityOutlined fontSize="small" />}
      </IconButton>
    </Tooltip>
  )
}

/** An amount that is either shown or replaced by the mask (no digits in the page). */
export function Masked({ shown, what, children }) {
  return shown
    ? <span>{children}</span>
    : <Box component="span" aria-label={`${what} hidden`} sx={{ color: 'text.secondary', letterSpacing: 1 }}>{MASK}</Box>
}

/**
 * One masked amount with its eye button:
 *   <MaskedMoney amount={e.salary} format={formatMoney} what="salary" name={e.name} />
 */
export default function MaskedMoney({ amount, format, what, name }) {
  const [shown, setShown] = useReveal()
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, whiteSpace: 'nowrap' }}>
      <Masked shown={shown} what={what}>{format(amount)}</Masked>
      <RevealButton shown={shown} onToggle={() => setShown((s) => !s)} what={what} name={name} />
    </Box>
  )
}
