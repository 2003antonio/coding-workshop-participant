// The only code that touches localStorage for auth. It holds the refresh token
// and nothing else: access tokens live in memory only (see AuthContext.jsx).
// Every call is wrapped because storage can be unavailable (e.g. private mode);
// the app still works then, the session just does not survive a reload.

export const REFRESH_TOKEN_KEY = 'acme.refreshToken'

export function readRefreshToken() {
  try {
    return window.localStorage.getItem(REFRESH_TOKEN_KEY)
  } catch {
    return null
  }
}

export function saveRefreshToken(token) {
  try {
    window.localStorage.setItem(REFRESH_TOKEN_KEY, token)
  } catch {
    // Storage unavailable: the session lasts until the page is reloaded.
  }
}

export function clearRefreshToken() {
  try {
    window.localStorage.removeItem(REFRESH_TOKEN_KEY)
  } catch {
    // Nothing stored, nothing to clear.
  }
}
