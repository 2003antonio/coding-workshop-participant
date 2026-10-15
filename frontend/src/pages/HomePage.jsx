import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import { canSeeDashboard } from '../auth/roles'
import { useAuth } from '../auth/useAuth'
import AppShell from '../components/AppShell'
import Dashboard from '../components/dashboard/Dashboard'
import EmployeeHome from '../components/home/EmployeeHome'
import PageHeader from '../components/PageHeader'
import { ROLE_LABELS } from './format'

/**
 * Home: "Welcome, <name>" for every role, then the company dashboard (admin),
 * the team dashboard (manager) or a short summary of the person's own work with
 * cards that lead to My work and their projects (employee; the chart is on My work).
 */
export default function HomePage() {
  const { user, role } = useAuth()

  return (
    <AppShell>
      <PageHeader title={`Welcome, ${user?.name ?? ''}`} after={(
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1, color: 'text.secondary' }}>
          Signed in as <Chip label={ROLE_LABELS[role] ?? role} color="primary" size="small" />
        </Box>
      )} />
      {canSeeDashboard(role) ? <Dashboard role={role} /> : <EmployeeHome userId={user?.id} />}
    </AppShell>
  )
}
