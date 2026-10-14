import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'
import { useMediaQuery } from 'react-responsive'
import { useAuth } from '../auth/useAuth'
import AppShell from '../components/AppShell'

const ROLE_LABELS = { admin: 'Admin', manager: 'Manager', employee: 'Employee' }

/** The first protected page: who is signed in. Navigation and sign-out live in AppShell. */
export default function HomePage() {
  const { user, role } = useAuth()
  const isPhone = useMediaQuery({ maxWidth: 599 })

  return (
    <AppShell>
      <Typography variant={isPhone ? 'h5' : 'h4'} component="h1" gutterBottom>
        Welcome, {user?.name}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography color="text.secondary">Signed in as</Typography>
        <Chip label={ROLE_LABELS[role] ?? role} color="primary" size="small" />
      </Box>
    </AppShell>
  )
}
