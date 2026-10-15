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

export default function LoginPage() {
  const { login, status } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const isPhone = useMediaQuery({ maxWidth: 599 })

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
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
        <Box aria-hidden="true" sx={{
          width: 44, height: 44, borderRadius: '12px', bgcolor: 'sidebar.bg', color: 'sidebar.accent',
          display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 22, flexShrink: 0,
        }}>A</Box>
        <Box>
          <Typography sx={{ fontWeight: 800, lineHeight: 1.2 }}>ACME Project Tracker</Typography>
          <Typography variant="body2" color="text.secondary">Projects, people and budgets in one place.</Typography>
        </Box>
      </Box>
      <Typography variant="h5" component="h1">Sign in</Typography>
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
      minHeight: '100vh',
      display: 'flex',
      alignItems: isPhone ? 'flex-start' : 'center',
      justifyContent: 'center',
      bgcolor: isPhone ? 'background.paper' : 'background.default',
      backgroundImage: isPhone ? 'none' : (t) => `radial-gradient(circle at 20% 10%, ${(t.vars ?? t).palette.action.hover}, transparent 45%)`,
      px: 2,
      pt: isPhone ? 6 : 0,
    }}>
      {isPhone ? (
        <Box sx={{ width: '100%' }}>{form}</Box>
      ) : (
        <Paper elevation={3} sx={{ width: 420, maxWidth: '100%', p: 4, borderRadius: '16px', borderTop: 4, borderColor: 'secondary.main' }}>
          {form}
        </Paper>
      )}
    </Box>
  )
}
