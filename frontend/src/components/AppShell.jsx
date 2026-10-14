import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Container from '@mui/material/Container'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import { useMediaQuery } from 'react-responsive'
import { NavLink, useNavigate } from 'react-router-dom'
import { EMPLOYEE_LIST_ROLES } from '../auth/roles'
import { useAuth } from '../auth/useAuth'

// NavLink sets aria-current="page" on the active link; make it visible as well.
const navLinkSx = { '&[aria-current="page"]': { textDecoration: 'underline', textUnderlineOffset: 6 } }

/** The frame of every signed-in page: app bar with navigation and sign-out, then the page. */
export default function AppShell({ children, maxWidth = 'md' }) {
  const { role, logout } = useAuth()
  const navigate = useNavigate()
  const isPhone = useMediaQuery({ maxWidth: 599 })

  async function handleSignOut() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'grey.100' }}>
      <AppBar position="static">
        <Toolbar sx={{ gap: 1 }}>
          <Typography variant="h6" component="span" sx={{ flexGrow: 1 }}>
            {isPhone ? 'ACME' : 'ACME Project Tracker'}
          </Typography>
          <Box component="nav" aria-label="Main" sx={{ display: 'flex', gap: 1 }}>
            <Button color="inherit" component={NavLink} to="/" end sx={navLinkSx}>Home</Button>
            {EMPLOYEE_LIST_ROLES.includes(role) && (
              <Button color="inherit" component={NavLink} to="/employees" sx={navLinkSx}>
                Employees
              </Button>
            )}
          </Box>
          <Button color="inherit" onClick={handleSignOut}>Sign out</Button>
        </Toolbar>
      </AppBar>
      <Container component="main" maxWidth={maxWidth} sx={{ py: isPhone ? 3 : 6 }}>
        {children}
      </Container>
    </Box>
  )
}
