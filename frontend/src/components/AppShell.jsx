import { useState } from 'react'
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined'
import LightModeOutlined from '@mui/icons-material/LightModeOutlined'
import Logout from '@mui/icons-material/Logout'
import MenuIcon from '@mui/icons-material/Menu'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Container from '@mui/material/Container'
import Drawer from '@mui/material/Drawer'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import { useColorScheme } from '@mui/material/styles'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { useBreakpoint } from '../hooks/useBreakpoint'
import { navItemsFor, sectionTitle } from '../navigation'
import { ROLE_LABELS } from '../pages/format'

const SIDEBAR_WIDTH = 240

// Hidden until a keyboard user tabs to it; jumps past the navigation.
const skipLinkSx = {
  position: 'absolute', left: -9999, top: 8, zIndex: 2000, px: 2, py: 1, borderRadius: 1,
  bgcolor: 'background.paper', color: 'primary.main', fontWeight: 600,
  '&:focus': { left: 8 },
}

// NavLink sets aria-current="page" on the active link; show it with a bar and a tint too.
const navLinkSx = {
  minHeight: 44, borderRadius: 2, mx: 1, color: 'sidebar.fg', borderLeft: '3px solid transparent',
  '&:hover': { bgcolor: 'sidebar.active' },
  '&[aria-current="page"]': { bgcolor: 'sidebar.active', color: '#FFFFFF', borderLeftColor: 'sidebar.accent' },
  '&[aria-current="page"] .MuiListItemText-primary': { fontWeight: 700 },
  '&.Mui-focusVisible, &:focus-visible': { outline: '2px solid', outlineColor: 'sidebar.accent', outlineOffset: -2 },
}

/** Brand, then the role-aware links from navigation.js. */
function Sidebar({ role, onNavigate }) {
  return (
    <Box sx={{ height: '100%', bgcolor: 'sidebar.bg', color: 'sidebar.fg', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2.5, height: 64 }}>
        <Box aria-hidden="true" sx={{
          width: 32, height: 32, borderRadius: 2, bgcolor: 'sidebar.accent', color: '#0A2540',
          display: 'grid', placeItems: 'center', fontWeight: 800,
        }}>A</Box>
        <Typography component="div" sx={{ color: '#FFFFFF', fontWeight: 700, lineHeight: 1.2 }}>
          ACME<Box component="span" sx={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'sidebar.fg' }}>
            Project Tracker</Box>
        </Typography>
      </Box>
      <Box component="nav" aria-label="Main" sx={{ mt: 1 }}>
        <List disablePadding>
          {navItemsFor(role).map(({ to, label, icon: Icon, end }) => (
            <ListItem key={to} disablePadding sx={{ mb: 0.5 }}>
              <ListItemButton component={NavLink} to={to} end={end} onClick={onNavigate} sx={navLinkSx}>
                <ListItemIcon sx={{ minWidth: 36, color: 'inherit' }}><Icon fontSize="small" /></ListItemIcon>
                <ListItemText primary={label} />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </Box>
    </Box>
  )
}

/** Light/dark switch. Starts from the computer's setting; MUI remembers a choice. */
function ThemeToggle() {
  const { mode, systemMode, setMode } = useColorScheme()
  const isDark = (mode === 'system' ? systemMode : mode) === 'dark'
  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme'
  return (
    <IconButton aria-label={label} title={label} onClick={() => setMode(isDark ? 'light' : 'dark')}
      sx={{ width: 44, height: 44 }}>
      {isDark ? <LightModeOutlined /> : <DarkModeOutlined />}
    </IconButton>
  )
}

/**
 * The frame of every signed-in page: navy sidebar (a slide-out drawer below
 * 900 px, opened by "Menu"), a slim top bar with the section title, theme
 * toggle, who is signed in and "Sign out", then the page in <main>.
 */
export default function AppShell({ children, maxWidth = 'md' }) {
  const { user, role, logout } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { isPhone, isDesktop } = useBreakpoint()
  const [drawerOpen, setDrawerOpen] = useState(false)

  async function handleSignOut() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex' }}>
      <Box component="a" href="#main-content" sx={skipLinkSx}>Skip to content</Box>
      {isDesktop ? (
        <Box sx={{ width: SIDEBAR_WIDTH, flexShrink: 0, position: 'sticky', top: 0, height: '100vh' }}>
          <Sidebar role={role} />
        </Box>
      ) : (
        <Drawer id="main-drawer" open={drawerOpen} onClose={() => setDrawerOpen(false)}
          slotProps={{ paper: { sx: { width: SIDEBAR_WIDTH, border: 0 } } }}>
          <Sidebar role={role} onNavigate={() => setDrawerOpen(false)} />
        </Drawer>
      )}
      <Box sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <AppBar position="sticky" color="inherit" elevation={0}
          sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
          <Toolbar sx={{ gap: 1, minHeight: 64 }}>
            {!isDesktop && (
              <IconButton edge="start" aria-label="Menu" aria-controls={drawerOpen ? 'main-drawer' : undefined}
                aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)} sx={{ width: 44, height: 44 }}>
                <MenuIcon />
              </IconButton>
            )}
            <Typography component="div" variant="h6" noWrap sx={{ flexGrow: 1, fontSize: 18 }}>
              {sectionTitle(pathname)}
            </Typography>
            <ThemeToggle />
            {!isPhone && user && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mx: 1 }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{user.name}</Typography>
                <Chip size="small" label={ROLE_LABELS[role] ?? role} variant="outlined" color="secondary" />
              </Box>
            )}
            <Button color="primary" onClick={handleSignOut} sx={{ minHeight: 44 }}
              startIcon={isPhone ? null : <Logout />}>
              Sign out
            </Button>
          </Toolbar>
        </AppBar>
        <Container component="main" id="main-content" tabIndex={-1} maxWidth={maxWidth}
          sx={{ py: isPhone ? 3 : 5, outline: 'none' }}>
          {children}
        </Container>
      </Box>
    </Box>
  )
}
