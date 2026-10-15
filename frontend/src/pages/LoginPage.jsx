import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useMediaQuery } from 'react-responsive'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import ThemeToggle from '../components/ThemeToggle'
import MiniTimeline from '../components/login/MiniTimeline'

// Every message the user can see. Server error text is never shown directly.
const LOGIN_MESSAGES = {
  invalid: 'Invalid email or password.',
  missing: 'Enter your email and password.',
  badInput: 'Enter a valid email address and password.',
  network: "Can't reach the server. Please try again.",
  unknown: 'Something went wrong. Please try again.',
}

function messageFor(error) {
  if (error?.status === 401) return LOGIN_MESSAGES.invalid
  if (error?.status === 400) return LOGIN_MESSAGES.badInput
  if (error?.status === 0) return LOGIN_MESSAGES.network
  return LOGIN_MESSAGES.unknown
}

/** The ACME mark: the same as in the sidebar. */
function Mark({ size = 36 }) {
  return (
    <Box aria-hidden="true" sx={{
      width: size, height: size, borderRadius: '10px', bgcolor: 'sidebar.accent', color: '#0A2540',
      display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: size * 0.5, flexShrink: 0,
    }}>A</Box>
  )
}

function Wordmark() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Mark />
      <Typography component="p" sx={{ color: '#FFFFFF', fontWeight: 700, lineHeight: 1.2 }}>
        ACME
        <Box component="span" sx={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'sidebar.fg' }}>Project Tracker</Box>
      </Typography>
    </Box>
  )
}

/** Wide screens: the navy panel on the left, with the headline and the mini-timeline. */
function BrandPanel() {
  return (
    <Box component="aside" aria-label="About ACME Project Tracker" sx={{
      bgcolor: 'sidebar.bg', color: 'sidebar.fg', minHeight: '100vh', px: { md: 6, lg: 9 }, py: 6,
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 6, overflow: 'hidden',
    }}>
      <Wordmark />
      <Box sx={{ maxWidth: 480 }}>
        <Typography component="p" sx={{
          color: '#FFFFFF', fontWeight: 800, fontSize: { md: 40, lg: 48 }, lineHeight: 1.05, letterSpacing: '-0.025em',
        }}>
          See every project&apos;s week at a glance.
        </Typography>
        <Typography sx={{ mt: 2, fontSize: 17, lineHeight: 1.5, color: 'sidebar.fg', maxWidth: 420 }}>
          Deliverables, people and budgets in one place, with the 40-hour week kept honest.
        </Typography>
        <Box sx={{ mt: 5 }}><MiniTimeline /></Box>
      </Box>
      <Typography variant="body2" sx={{ color: 'sidebar.fg', opacity: 0.7 }}>Internal tool. Sign in with your work account.</Typography>
    </Box>
  )
}

/** Narrow screens: a compact navy header above the card instead of the panel. */
function BrandHeader() {
  return (
    <Box component="header" sx={{ bgcolor: 'sidebar.bg', px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
      <Box sx={{ flexGrow: 1 }}><Wordmark /></Box>
      <ThemeToggle sx={{ color: 'sidebar.fg' }} />
    </Box>
  )
}

export default function LoginPage() {
  const { login, status } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const isNarrow = useMediaQuery({ maxWidth: 899 }) // below 900 px: no illustration, a compact brand header

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const destination = location.state?.from?.pathname || '/'

  if (status === 'authenticated') {
    return <Navigate to={destination} replace />
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!email.trim() || !password) {
      setError(LOGIN_MESSAGES.missing)
      return
    }
    setError('')
    setSubmitting(true)
    try {
      await login(email.trim(), password)
      navigate(destination, { replace: true })
    } catch (err) {
      setError(messageFor(err))
      setSubmitting(false)
    }
  }

  const form = (
    <Box component="form" onSubmit={handleSubmit} noValidate
      sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>Sign in</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Use your ACME work email.</Typography>
      </Box>
      <TextField
        label="Email"
        type="email"
        name="email"
        autoComplete="username"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        fullWidth
        autoFocus
      />
      <TextField
        label="Password"
        type="password"
        name="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        fullWidth
      />
      <Button type="submit" variant="contained" size="large" fullWidth disabled={submitting}
        startIcon={submitting ? <CircularProgress size={18} color="inherit" /> : null}>
        {submitting ? 'Signing in…' : 'Sign in'}
      </Button>
      {error && <Alert severity="error">{error}</Alert>}
    </Box>
  )

  return (
    <Box sx={{
      minHeight: '100vh', display: 'grid', bgcolor: 'background.default',
      gridTemplateColumns: isNarrow ? 'minmax(0, 1fr)' : 'minmax(0, 5fr) minmax(0, 4fr)',
      gridTemplateRows: isNarrow ? 'auto 1fr' : 'auto',
    }}>
      {isNarrow ? <BrandHeader /> : <BrandPanel />}
      <Box component="main" sx={{
        position: 'relative', display: 'flex', justifyContent: 'center', px: 2, minWidth: 0,
        alignItems: isNarrow ? 'flex-start' : 'center', py: isNarrow ? 4 : 6,
      }}>
        {!isNarrow && <ThemeToggle sx={{ position: 'absolute', top: 16, right: 16 }} />}
        <Paper variant="outlined" sx={{ width: 400, maxWidth: '100%', minWidth: 0, p: { xs: 3, sm: 4 }, borderRadius: '16px' }}>
          {form}
        </Paper>
      </Box>
    </Box>
  )
}
