// Who may be picked for what, from the admin's employee list. The server
// checks the same rules (docs/api-contract.md §3, §6); these only shorten pick lists.

const isActive = (e) => !e.archived_at

/** May lead a team: active managers and admins who are not members of it. */
export const leadCandidates = (employees, teamId = null) =>
  employees.filter((e) => isActive(e) && ['manager', 'admin'].includes(e.role) && (!teamId || e.team_id !== teamId))

/** May join a team: active, on no team, and not its lead. */
export const memberCandidates = (employees, team) =>
  employees.filter((e) => isActive(e) && !e.team_id && e.id !== team.lead?.id)

/** "Platform", "No team", or "Other team" when the caller can't see that team's name. */
export function teamName(teamId, teams) {
  if (!teamId) return 'No team'
  return teams.find((t) => t.id === teamId)?.name ?? 'Other team'
}
