import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import { canSeeDashboard } from '../auth/roles'
import { useAuth } from '../auth/useAuth'
import AppShell from '../components/AppShell'
import Dashboard from '../components/dashboard/Dashboard'
import MyWorkView from '../components/mywork/MyWorkView'
import PageHeader from '../components/PageHeader'
import { ROLE_LABELS } from './format'

/**
 * Home: "Welcome, <name>" for every role, then the company dashboard (admin),
 * the team dashboard (manager) or the person's own work (employee).
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
      {canSeeDashboard(role) ? <Dashboard role={role} /> : <MyWorkView />}
    </AppShell>
  )
}
