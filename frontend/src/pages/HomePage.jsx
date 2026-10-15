import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'
import { canSeeDashboard } from '../auth/roles'
import { useAuth } from '../auth/useAuth'
import AppShell from '../components/AppShell'
import Dashboard from '../components/dashboard/Dashboard'
import MyWorkView from '../components/mywork/MyWorkView'
import { useBreakpoint } from '../hooks/useBreakpoint'
import { ROLE_LABELS } from './format'

/**
 * Home: "Welcome, <name>" for every role, then the company dashboard (admin),
 * the team dashboard (manager) or the person's own work (employee).
 */
export default function HomePage() {
  const { user, role } = useAuth()
  const { isPhone } = useBreakpoint()

  return (
    <AppShell maxWidth="lg">
      <Typography variant={isPhone ? 'h5' : 'h4'} component="h1" gutterBottom>
        Welcome, {user?.name}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Typography color="text.secondary">Signed in as</Typography>
        <Chip label={ROLE_LABELS[role] ?? role} color="primary" size="small" />
      </Box>
      {canSeeDashboard(role) ? <Dashboard role={role} /> : <MyWorkView />}
    </AppShell>
  )
}
