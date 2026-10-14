import Chip from '@mui/material/Chip'
import { DELIVERABLE_STATUS, PROJECT_STATUS } from '../pages/format'
import { toneSx } from '../theme'

/** Which status colour (theme.js STATUS_COLORS) each project or deliverable status uses. */
const TONES = {
  planned: 'not_started',
  active: 'in_progress',
  on_hold: 'blocked',
  completed: 'done',
  not_started: 'not_started',
  in_progress: 'in_progress',
  done: 'done',
}

/** A project or deliverable status as a small labelled chip. */
export default function StatusChip({ status }) {
  const label = PROJECT_STATUS[status] ?? DELIVERABLE_STATUS[status] ?? status
  return <Chip size="small" label={label} sx={toneSx(TONES[status] ?? 'not_started')} />
}
