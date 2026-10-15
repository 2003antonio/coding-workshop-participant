import BlockOutlined from '@mui/icons-material/BlockOutlined'
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined'
import PauseCircleOutlined from '@mui/icons-material/PauseCircleOutlined'
import PlayCircleOutlined from '@mui/icons-material/PlayCircleOutlined'
import RadioButtonUncheckedOutlined from '@mui/icons-material/RadioButtonUncheckedOutlined'
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

/** An icon per status, so the chips differ by shape as well as colour (the label still says it). */
const ICONS = {
  planned: RadioButtonUncheckedOutlined,
  active: PlayCircleOutlined,
  on_hold: PauseCircleOutlined,
  completed: CheckCircleOutlined,
  not_started: RadioButtonUncheckedOutlined,
  in_progress: PlayCircleOutlined,
  done: CheckCircleOutlined,
}

/** A project or deliverable status as a small labelled chip with an icon. */
export default function StatusChip({ status }) {
  const label = PROJECT_STATUS[status] ?? DELIVERABLE_STATUS[status] ?? status
  const Icon = ICONS[status] ?? BlockOutlined
  return (
    <Chip size="small" label={label} icon={<Icon aria-hidden="true" />}
      sx={[toneSx(TONES[status] ?? 'not_started'), { fontWeight: 700, '& .MuiChip-icon': { color: 'inherit', fontSize: 16 } }]} />
  )
}
