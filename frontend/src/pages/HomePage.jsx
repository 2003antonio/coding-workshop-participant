import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Container from '@mui/material/Container'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import { useMediaQuery } from 'react-responsive'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'

const ROLE_LABELS = { admin: 'Admin', manager: 'Manager', employee: 'Employee' }

/** The first protected page: who is signed in, and a way to sign out. */
export default function HomePage() {
  const { user, role, logout } = useAuth()
  const navigate = useNavigate()
  const isPhone = useMediaQuery({ maxWidth: 599 })

  async function handleSignOut() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'grey.100' }}>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" component="span" sx={{ flexGrow: 1 }}>
            {isPhone ? 'ACME' : 'ACME Project Tracker'}
          </Typography>
          <Button color="inherit" onClick={handleSignOut}>Sign out</Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="md" sx={{ py: isPhone ? 3 : 6 }}>
        <Typography variant={isPhone ? 'h5' : 'h4'} component="h1" gutterBottom>
          Welcome, {user?.name}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography color="text.secondary">Signed in as</Typography>
          <Chip label={ROLE_LABELS[role] ?? role} color="primary" size="small" />
        </Box>
      </Container>
    </Box>
  )
}
