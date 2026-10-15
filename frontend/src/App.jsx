import { Suspense } from 'react'
import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider } from '@mui/material/styles'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import ProtectedRoute from './auth/ProtectedRoute'
import { PageSkeleton } from './components/PageState'
import ToastProvider from './components/toast/ToastProvider'
import { PROTECTED_ROUTES, PUBLIC_ROUTES } from './routes'
import theme from './theme'

/** Routes (routes.jsx): public ones, then everything inside <ProtectedRoute> needs a session. */
export default function App() {
  return (
    <ThemeProvider theme={theme} noSsr>
      <CssBaseline />
      <AuthProvider>
        <ToastProvider>
          <Suspense fallback={<PageSkeleton />}>
            <Routes>
              {PUBLIC_ROUTES.map(({ path, Page }) => <Route key={path} path={path} element={<Page />} />)}
              <Route element={<ProtectedRoute />}>
                {PROTECTED_ROUTES.map(({ path, Page }) => <Route key={path} path={path} element={<Page />} />)}
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
