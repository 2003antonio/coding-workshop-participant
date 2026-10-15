// How the dashboard shows each at-risk reason code (docs/api-contract.md §8,
// report 2): a short label, an icon and a status colour from theme.js. The
// label always says the reason, so colour and icon are never the only signal.
import AssignmentLateOutlined from '@mui/icons-material/AssignmentLateOutlined'
import BlockOutlined from '@mui/icons-material/BlockOutlined'
import EventBusyOutlined from '@mui/icons-material/EventBusyOutlined'
import MoneyOffOutlined from '@mui/icons-material/MoneyOffOutlined'
import PersonOffOutlined from '@mui/icons-material/PersonOffOutlined'
import ReportProblemOutlined from '@mui/icons-material/ReportProblemOutlined'
import SyncProblemOutlined from '@mui/icons-material/SyncProblemOutlined'

export const RISK_CHIPS = {
  past_end_date: { label: 'Past end date', icon: EventBusyOutlined, tone: 'overdue' },
  overdue_deliverable: { label: 'Overdue deliverable', icon: AssignmentLateOutlined, tone: 'overdue' },
  blocked_past_start: { label: 'Blocked', icon: BlockOutlined, tone: 'blocked' },
  dependency_date_conflict: { label: 'Dependency date conflict', icon: SyncProblemOutlined, tone: 'blocked' },
  unstaffed: { label: 'Unstaffed', icon: PersonOffOutlined, tone: 'not_started' },
  over_budget: { label: 'Over budget', icon: MoneyOffOutlined, tone: 'over_budget' },
}

const OTHER = { label: 'Other risk', icon: ReportProblemOutlined, tone: 'not_started' }

/** The chip for a reason code; an unknown code still gets a readable chip. */
export const riskChip = (reason) => RISK_CHIPS[reason] ?? OTHER
