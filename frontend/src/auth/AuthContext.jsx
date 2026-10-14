import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as authService from '../services/authService'
import { AuthContext } from './useAuth'
import { clearRefreshToken, readRefreshToken, saveRefreshToken } from './tokenStorage'

// Refresh tokens are single-use: the server treats a second use of the same
// token as theft and signs the user out everywhere. So only one refresh may run
// at a time: within this tab (one shared promise) and across tabs (Web Locks,
// where the browser supports them).
function withCrossTabLock(task) {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request('acme-auth-refresh', task)
  }
  return task()
}

/**
 * The single source of truth for "who is logged in".
 *
 * - user / role / status live in React state so pages re-render on change.
 * - The access token lives in memory only (a ref), never in localStorage.
 * - The refresh token is the only value persisted (tokenStorage.js), so a
 *   session survives a reload; on load it is exchanged for a new access token
 *   and the current user before protected pages render.
 */
export function AuthProvider({ children }) {
  const [status, setStatus] = useState(() => (readRefreshToken() ? 'checking' : 'anonymous'))
  const [user, setUser] = useState(null)
  const accessTokenRef = useRef(null)
  const refreshInFlightRef = useRef(null)

  const endSession = useCallback(() => {
    clearRefreshToken()
    accessTokenRef.current = null
    setUser(null)
    setStatus('anonymous')
  }, [])

  /** Exchange the stored refresh token for a new access token and the current user. */
  const refreshSession = useCallback(() => {
    if (refreshInFlightRef.current) return refreshInFlightRef.current

    const run = withCrossTabLock(async () => {
      // Read inside the lock: another tab may have just rotated the token.
      const stored = readRefreshToken()
      if (!stored) throw new authService.AuthError(401, 'no_session')
      const tokens = await authService.refresh(stored)
      saveRefreshToken(tokens.refresh_token)
      accessTokenRef.current = tokens.access_token
      return authService.getMe(tokens.access_token)
    })
      .then((me) => {
        setUser(me)
        setStatus('authenticated')
        return me
      })
      .catch((error) => {
        if (error.status === 401 || error.status === 403) {
          endSession() // the server rejected the session: forget it
        } else {
          // Network or server trouble: keep the stored token so a later reload can retry.
          accessTokenRef.current = null
          setUser(null)
          setStatus('anonymous')
        }
        throw error
      })
      .finally(() => {
        refreshInFlightRef.current = null
      })

    refreshInFlightRef.current = run
    return run
  }, [endSession])

  // On app load: restore the session if a refresh token was stored.
  useEffect(() => {
    if (readRefreshToken()) {
      refreshSession().catch(() => {}) // failure already handled: status is 'anonymous'
    }
  }, [refreshSession])

  const login = useCallback(async (email, password) => {
    const data = await authService.login(email, password)
    saveRefreshToken(data.refresh_token)
    accessTokenRef.current = data.access_token
    setUser(data.user)
    setStatus('authenticated')
    return data.user
  }, [])

  const logout = useCallback(async () => {
    const stored = readRefreshToken()
    endSession() // clear locally first so the UI responds even if the network is down
    if (stored) {
      try {
        await authService.logout(stored)
      } catch {
        // Best effort: the token expires on its own if the server was unreachable.
      }
    }
  }, [endSession])

  const getAccessToken = useCallback(() => accessTokenRef.current, [])

  const value = useMemo(
    () => ({
      user,
      role: user?.role ?? null,
      status,
      isAuthenticated: status === 'authenticated',
      login,
      logout,
      refreshSession,
      getAccessToken,
    }),
    [user, status, login, logout, refreshSession, getAccessToken],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
