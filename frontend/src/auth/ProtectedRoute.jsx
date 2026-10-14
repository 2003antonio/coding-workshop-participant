import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './useAuth'

/**
 * Wrap private routes with this:
 *   <Route element={<ProtectedRoute />}> ...private routes... </Route>
 * - while a stored session is being restored: a loading spinner;
 * - no valid session: redirect to /login (remembering where the user was going);
 * - otherwise: render the page.
 */
export default function ProtectedRoute() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'checking') {
    return (
      <Box role="status" aria-label="Checking your session"
        sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress />
      </Box>
    )
  }
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  return <Outlet />
}
