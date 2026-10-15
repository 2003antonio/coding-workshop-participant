import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import { useSearchParams } from 'react-router-dom'
import { reportsFor } from '../auth/roles'
import { useAuth } from '../auth/useAuth'
import AppShell from '../components/AppShell'
import PageHeader from '../components/PageHeader'
import {
  AtRiskReport, BudgetReport, CapacityReport, ChainReport, DeliverablesReport, ProjectStatusReport, ResourcesReport,
} from '../components/ReportViews'

const REPORTS = {
  status: { label: 'Project status', View: ProjectStatusReport },
  risk: { label: 'At risk', View: AtRiskReport },
  resources: { label: 'Resources', View: ResourcesReport },
  deliverables: { label: 'Deliverables', View: DeliverablesReport },
  capacity: { label: 'Near capacity', View: CapacityReport },
  chain: { label: 'Dependencies', View: ChainReport },
  budget: { label: 'Budget', View: BudgetReport },
}

/** Readable names for ?tab= (Home's cards link to /reports?tab=at-risk and so on). */
const TAB_SLUGS = {
  'project-status': 'status', 'at-risk': 'risk', resources: 'resources', deliverables: 'deliverables',
  'near-capacity': 'capacity', dependencies: 'chain', budget: 'budget',
}

/**
 * All reports the caller's role may open, one per tab (?report=<key> keeps the choice in the URL;
 * ?tab=<slug> opens one too). A report the role may not open, or an unknown name, opens the first tab.
 */
export default function ReportsPage() {
  const { role } = useAuth()
  const [params, setParams] = useSearchParams()
  const allowed = reportsFor(role)
  const tab = params.get('tab') ?? ''
  const asked = params.get('report') ?? (Object.hasOwn(TAB_SLUGS, tab) ? TAB_SLUGS[tab] : null)
  const current = allowed.includes(asked) ? asked : allowed[0]
  const { View } = REPORTS[current]

  return (
    <AppShell>
      <PageHeader title="Reports" subtitle="Status, risk, people and money across the projects you can see." />
      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Tabs value={current} onChange={(event, value) => setParams({ report: value }, { replace: true })}
          aria-label="Reports" variant="scrollable" allowScrollButtonsMobile>
          {allowed.map((key) => (
            <Tab key={key} value={key} label={REPORTS[key].label} id={`report-tab-${key}`}
              aria-controls={`report-panel-${key}`} />
          ))}
        </Tabs>
      </Paper>
      <Box role="tabpanel" id={`report-panel-${current}`} aria-labelledby={`report-tab-${current}`}>
        <View key={current} />
      </Box>
    </AppShell>
  )
}
