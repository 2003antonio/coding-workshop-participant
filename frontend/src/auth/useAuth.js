import { createContext, useContext } from 'react'

// The shared "who is logged in" state. Provided by <AuthProvider> (AuthContext.jsx).
// Kept in its own file so AuthContext.jsx exports only a component (fast refresh).
export const AuthContext = createContext(null)

/**
 * Read the session from any component:
 *   const { user, role, status, isAuthenticated, login, logout } = useAuth()
 * status is 'checking' (restoring after a reload), 'authenticated' or 'anonymous'.
 */
export function useAuth() {
  const value = useContext(AuthContext)
  if (value === null) {
    throw new Error('useAuth() must be used inside <AuthProvider>')
  }
  return value
}
