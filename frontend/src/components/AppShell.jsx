import { useState } from 'react'
import ChevronLeft from '@mui/icons-material/ChevronLeft'
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined'
import LightModeOutlined from '@mui/icons-material/LightModeOutlined'
import Logout from '@mui/icons-material/Logout'
import MenuIcon from '@mui/icons-material/Menu'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Drawer from '@mui/material/Drawer'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Toolbar from '@mui/material/Toolbar'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useColorScheme } from '@mui/material/styles'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { useBreakpoint } from '../hooks/useBreakpoint'
import { navItemsFor, sectionTitle } from '../navigation'
import { ROLE_LABELS } from '../pages/format'
import PageContainer from './PageContainer'
import PageTransition from './motion/PageTransition'

const SIDEBAR_WIDTH = 240
/** The collapsed sidebar: icons only. */
export const RAIL_WIDTH = 72
/** Where the collapsed/expanded choice is remembered (this browser only). */
export const COLLAPSE_KEY = 'acme.sidebarCollapsed'

/** The remembered choice. Storage can be blocked (private window), so it never throws. */
function readCollapsed() {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === 'true'
  } catch {
    return false
  }
}
function saveCollapsed(value) {
  try {
    window.localStorage.setItem(COLLAPSE_KEY, String(value))
  } catch {
    // Not remembered; the sidebar still works for this visit.
  }
}

// Off screen but still read out: the link names stay when the sidebar is collapsed.
const visuallyHidden = {
  position: 'absolute', width: 1, height: 1, p: 0, m: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap', border: 0,
}

// Hidden until a keyboard user tabs to it; jumps past the navigation.
const skipLinkSx = {
  position: 'absolute', left: -9999, top: 8, zIndex: 2000, px: 2, py: 1, borderRadius: 1,
  bgcolor: 'background.paper', color: 'primary.main', fontWeight: 600,
  '&:focus': { left: 8 },
}

// Width changes slide, unless the computer asks for reduced motion.
const slide = (property) => ({
  transition: `${property} 200ms ease`,
  '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
})

// NavLink sets aria-current="page" on the active link; show it with a bar and a tint too.
const navLinkSx = {
  minHeight: 44, borderRadius: 2, mx: 1, color: 'sidebar.fg', borderLeft: '3px solid transparent',
  '&:hover': { bgcolor: 'sidebar.active' },
  '&[aria-current="page"]': { bgcolor: 'sidebar.active', color: '#FFFFFF', borderLeftColor: 'sidebar.accent' },
  '&[aria-current="page"] .MuiListItemText-primary': { fontWeight: 700 },
  '&.Mui-focusVisible, &:focus-visible': { outline: '2px solid', outlineColor: 'sidebar.accent', outlineOffset: -2 },
}

/**
 * Brand, then the role-aware links from navigation.js. Collapsed, only the
 * icons show; each link keeps its text for screen readers and gets a tooltip.
 */
function Sidebar({ role, onNavigate, collapsed = false }) {
  return (
    <Box sx={{
      height: '100%', bgcolor: 'sidebar.bg', color: 'sidebar.fg', display: 'flex', flexDirection: 'column',
      overflow: 'hidden', borderRight: 1, borderColor: 'sidebar.edge',
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2.5, height: 64, flexShrink: 0 }}>
        <Box aria-hidden="true" sx={{
          width: 32, height: 32, flexShrink: 0, borderRadius: 2, bgcolor: 'sidebar.accent', color: '#0A2540',
          display: 'grid', placeItems: 'center', fontWeight: 800,
        }}>A</Box>
        <Typography component="div" noWrap sx={[{ color: '#FFFFFF', fontWeight: 700, lineHeight: 1.2 }, collapsed && visuallyHidden]}>
          ACME<Box component="span" sx={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'sidebar.fg' }}>
            Project Tracker</Box>
        </Typography>
      </Box>
      <Box component="nav" aria-label="Main" sx={{ mt: 1, flexGrow: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        <List disablePadding>
          {navItemsFor(role).map(({ to, label, icon: Icon, end }) => {
            const link = (
              <ListItemButton component={NavLink} to={to} end={end} onClick={onNavigate} sx={navLinkSx}>
                <ListItemIcon sx={{ minWidth: 36, color: 'inherit' }}><Icon fontSize="small" /></ListItemIcon>
                <ListItemText primary={label} sx={collapsed ? visuallyHidden : { whiteSpace: 'nowrap' }} />
              </ListItemButton>
            )
            return (
              <ListItem key={to} disablePadding sx={{ mb: 0.5 }}>
                {collapsed ? <Tooltip title={label} placement="right" describeChild>{link}</Tooltip> : link}
              </ListItem>
            )
          })}
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
      sx={{ width: 44, height: 44, flexShrink: 0 }}>
      {isDark ? <LightModeOutlined /> : <DarkModeOutlined />}
    </IconButton>
  )
}

/**
 * The frame of every signed-in page: a navy sidebar pinned to the left (it
 * collapses to an icon rail on desktop, and is a slide-out drawer below 900 px,
 * opened by "Menu"), a slim top bar with the section title, theme toggle, who
 * is signed in and "Sign out", then the page in <main> (PageContainer).
 */
export default function AppShell({ children }) {
  const { user, role, logout } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { isPhone, isDesktop } = useBreakpoint()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(readCollapsed)

  function toggleCollapsed() {
    setCollapsed((was) => {
      saveCollapsed(!was)
      return !was
    })
  }

  async function handleSignOut() {
    await logout()
    navigate('/login', { replace: true })
  }

  const collapseLabel = collapsed ? 'Expand sidebar' : 'Collapse sidebar'

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default', display: 'flex' }}>
      <Box component="a" href="#main-content" sx={skipLinkSx}>Skip to content</Box>
      {isDesktop ? (
        // The outer box stretches to the page height so the navy runs to the bottom at any
        // scroll; the inner one is pinned to the screen and scrolls its links on its own.
        <Box sx={{
          flexShrink: 0, bgcolor: 'sidebar.bg', zIndex: (t) => t.zIndex.appBar + 1,
          width: collapsed ? RAIL_WIDTH : SIDEBAR_WIDTH, ...slide('width'),
        }}>
          <Box data-testid="sidebar" sx={{ position: 'sticky', top: 0, height: '100dvh' }}>
            <Sidebar role={role} collapsed={collapsed} />
            <Tooltip title={collapseLabel} placement="right">
              <IconButton aria-label={collapseLabel} aria-expanded={!collapsed} onClick={toggleCollapsed} size="small"
                sx={{
                  position: 'absolute', top: 76, right: -14, width: 28, height: 28,
                  bgcolor: 'background.paper', color: 'text.primary', border: 1, borderColor: 'divider', boxShadow: 1,
                  '&:hover': { bgcolor: 'background.paper' },
                  '&.Mui-focusVisible, &:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
                }}>
                <ChevronLeft fontSize="small" sx={{ transform: collapsed ? 'rotate(180deg)' : 'none', ...slide('transform') }} />
              </IconButton>
            </Tooltip>
          </Box>
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
          <Toolbar sx={{ gap: 1, minHeight: 64, minWidth: 0, pl: { md: 4 } }}>
            {!isDesktop && (
              <IconButton edge="start" aria-label="Menu" aria-controls={drawerOpen ? 'main-drawer' : undefined}
                aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)} sx={{ width: 44, height: 44, flexShrink: 0 }}>
                <MenuIcon />
              </IconButton>
            )}
            <Typography component="div" variant="h6" noWrap sx={{ flexGrow: 1, minWidth: 0, fontSize: 18 }}>
              {sectionTitle(pathname)}
            </Typography>
            <ThemeToggle />
            {!isPhone && user && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mx: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 600, minWidth: 0 }}>{user.name}</Typography>
                <Chip size="small" label={ROLE_LABELS[role] ?? role} variant="outlined" color="secondary"
                  sx={{ flexShrink: 0 }} />
              </Box>
            )}
            <Button color="primary" onClick={handleSignOut} sx={{ minHeight: 44, flexShrink: 0, whiteSpace: 'nowrap' }}
              startIcon={isPhone ? null : <Logout />}>
              Sign out
            </Button>
          </Toolbar>
        </AppBar>
        <PageContainer>
          <PageTransition>{children}</PageTransition>
        </PageContainer>
      </Box>
    </Box>
  )
}
