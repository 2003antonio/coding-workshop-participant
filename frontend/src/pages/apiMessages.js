// Every message a page can show for a failed request. Server error text is never
// shown: only these fixed messages, chosen by error code, then by status.

const BY_CODE = {
  invalid_lead: 'Choose an active manager or admin as the lead.',
  invalid_team: 'Choose an active team.',
  invalid_employee: 'That person is archived or no longer exists.',
  invalid_dependency: 'A deliverable can only depend on other active deliverables of this project.',
  invalid_dates: 'Check the dates: the start must be on or before the end, and inside the project dates.',
  invalid_range: 'Choose a date range of at most 52 weeks.',
  name_taken: 'A team with that name already exists.',
  on_other_team: 'That person is on another team. Remove them from it first.',
  already_member: 'That person is already on this team.',
  has_active_projects: "Archive this team's projects first.",
  leads_team: 'This person leads a team. Choose a new lead for that team first.',
  lead_cannot_be_member: 'A team lead cannot also be a member of the team they lead.',
  dates_conflict: 'Some deliverables or assignments fall outside these dates.',
  deliverables_open: 'Finish every deliverable before marking the project completed.',
  project_closed: 'This project is archived or completed, so no one can be assigned to it.',
  dependency_cycle: 'That would make the dependencies go round in a loop.',
  dependencies_not_done: 'Its dependencies must be done first.',
  dependents_started: 'Deliverables that depend on this one have already started.',
  has_dependents: 'Other deliverables depend on this one.',
  over_allocated: 'This would put the person over 40 hours in some weeks.',
  overlapping_allocation: 'This person is already assigned to this project for those dates.',
  archived: "Archived records can't be changed.",
  already_archived: 'That is already archived.',
  email_taken: 'An employee with that email already exists.',
  last_admin: 'There must always be at least one active admin.',
  cannot_archive_self: "You can't archive your own account.",
}

export const API_MESSAGES = {
  badInput: 'Some details were not accepted. Check the form and try again.',
  forbidden: "You don't have permission to do that.",
  notFound: "That item doesn't exist or you can't see it.",
  network: "Can't reach the server. Please try again.",
  unknown: 'Something went wrong. Please try again.',
}

export function messageFor(error) {
  if (BY_CODE[error?.code]) return BY_CODE[error.code]
  if (error?.status === 400) return API_MESSAGES.badInput
  if (error?.status === 403) return API_MESSAGES.forbidden
  if (error?.status === 404) return API_MESSAGES.notFound
  if (error?.status === 0) return API_MESSAGES.network
  return API_MESSAGES.unknown
}
