import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined'
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined'
import EventOutlined from '@mui/icons-material/EventOutlined'
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined'
import Chip from '@mui/material/Chip'
import { toneSx } from '../../theme'
import { localToday } from '../home/homeMath'
import { dueInfo } from './vizMath'

const ICONS = { overdue: ErrorOutlineOutlined, blocked: ScheduleOutlined, not_started: EventOutlined, done: CheckCircleOutlined }

/**
 * "Due in 3 days", "Due today", "2 days overdue" (or "Done"), counted from today
 * on this computer (local time), in a status colour with an icon; the words say it all.
 */
export default function DueChip({ due, done = false, today = localToday() }) {
  if (!due) return null
  const { text, tone } = dueInfo(due, today, done)
  const Icon = ICONS[tone]
  return (
    <Chip size="small" icon={<Icon aria-hidden="true" />} label={text} data-tone={tone}
      sx={[toneSx(tone), { '& .MuiChip-icon': { color: 'inherit' } }]} />
  )
}
