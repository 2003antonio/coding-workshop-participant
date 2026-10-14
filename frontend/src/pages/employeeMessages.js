// Every message the Employees page can show for a failed request. Server error
// text is never shown directly: only these, chosen by status and error code.

const BY_CODE = {
  email_taken: 'An employee with that email already exists.',
  last_admin: 'There must always be at least one active admin.',
  cannot_archive_self: "You can't archive your own account.",
  already_archived: 'That employee is already archived.',
  archived: "Archived employees can't be changed.",
}

export const EMPLOYEE_MESSAGES = {
  badInput: 'Some details were not accepted. Check the form and try again.',
  forbidden: "You don't have permission to do that.",
  notFound: 'That employee no longer exists. Refresh the list.',
  network: "Can't reach the server. Please try again.",
  unknown: 'Something went wrong. Please try again.',
}

export function messageFor(error) {
  if (BY_CODE[error?.code]) return BY_CODE[error.code]
  if (error?.status === 400) return EMPLOYEE_MESSAGES.badInput
  if (error?.status === 403) return EMPLOYEE_MESSAGES.forbidden
  if (error?.status === 404) return EMPLOYEE_MESSAGES.notFound
  if (error?.status === 0) return EMPLOYEE_MESSAGES.network
  return EMPLOYEE_MESSAGES.unknown
}
