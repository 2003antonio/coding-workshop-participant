import Chip from '@mui/material/Chip'
import { DELIVERABLE_STATUS, PROJECT_STATUS } from '../pages/format'

const COLORS = {
  planned: 'default',
  active: 'primary',
  on_hold: 'warning',
  completed: 'success',
  not_started: 'default',
  in_progress: 'primary',
  done: 'success',
}

/** A project or deliverable status as a small labelled chip. */
export default function StatusChip({ status }) {
  const label = PROJECT_STATUS[status] ?? DELIVERABLE_STATUS[status] ?? status
  return <Chip size="small" label={label} color={COLORS[status] ?? 'default'} variant="outlined" />
}
