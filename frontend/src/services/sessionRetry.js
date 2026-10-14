// Access tokens live only 15 minutes. When an API call answers 401, the
// session is refreshed (AuthContext's refreshSession: one refresh at a time,
// across tabs) and the call is tried exactly ONCE more with the new token.
// If the refresh itself fails, AuthContext has already ended the session.

/**
 * Run call(accessToken); on a 401, refresh the session and run it once more.
 *
 *   const { getAccessToken, refreshSession } = useAuth()
 *   const rows = await withSessionRetry(
 *     (token) => employeeService.listEmployees(token),
 *     { getAccessToken, refreshSession },
 *   )
 *
 * Any other error, a failed refresh, or a second 401 is thrown to the caller.
 */
export async function withSessionRetry(call, { getAccessToken, refreshSession }) {
  try {
    return await call(getAccessToken())
  } catch (error) {
    if (error?.status !== 401) throw error
  }
  await refreshSession()
  return call(getAccessToken())
}
