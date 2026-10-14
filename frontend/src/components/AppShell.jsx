import { useState } from 'react'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Container from '@mui/material/Container'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import { useMediaQuery } from 'react-responsive'
import { NavLink, useNavigate } from 'react-router-dom'
import { EMPLOYEE_LIST_ROLES } from '../auth/roles'
import { useAuth } from '../auth/useAuth'

// NavLink sets aria-current="page" on the active link; make it visible as well.
const navLinkSx = { '&[aria-current="page"]': { textDecoration: 'underline', textUnderlineOffset: 6 } }

/** The pages this role can use. Links to pages a role cannot use are not shown. */
function linksFor(role) {
  return [
    { to: '/', label: 'Home', end: true },
    { to: '/projects', label: 'Projects' },
    { to: '/teams', label: 'Teams' },
    { to: '/reports', label: 'Reports' },
    ...(EMPLOYEE_LIST_ROLES.includes(role) ? [{ to: '/employees', label: 'Employees' }] : []),
  ]
}

/** The frame of every signed-in page: app bar with navigation and sign-out, then the page. */
export default function AppShell({ children, maxWidth = 'md' }) {
  const { role, logout } = useAuth()
  const navigate = useNavigate()
  const isPhone = useMediaQuery({ maxWidth: 599 })
  const [menuAnchor, setMenuAnchor] = useState(null)
  const links = linksFor(role)

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
            {isPhone ? (
              <>
                <Button color="inherit" id="main-menu-button" aria-haspopup="true"
                  aria-controls={menuAnchor ? 'main-menu' : undefined}
                  aria-expanded={menuAnchor ? 'true' : undefined}
                  onClick={(event) => setMenuAnchor(event.currentTarget)}>
                  Menu
                </Button>
                <Menu id="main-menu" anchorEl={menuAnchor} open={Boolean(menuAnchor)}
                  onClose={() => setMenuAnchor(null)}
                  slotProps={{ list: { 'aria-labelledby': 'main-menu-button' } }}>
                  {links.map((link) => (
                    <MenuItem key={link.to} component={NavLink} to={link.to} end={link.end}
                      onClick={() => setMenuAnchor(null)}>
                      {link.label}
                    </MenuItem>
                  ))}
                </Menu>
              </>
            ) : links.map((link) => (
              <Button key={link.to} color="inherit" component={NavLink} to={link.to} end={link.end} sx={navLinkSx}>
                {link.label}
              </Button>
            ))}
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
