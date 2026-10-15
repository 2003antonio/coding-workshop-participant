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

/** The active teams this person leads, from a team list (a lead is never a member of their own team). */
export const ledTeams = (employeeId, teams) => teams.filter((t) => !t.archived_at && t.lead?.id === employeeId)

/**
 * What the Team column says about someone: their team as a member, else
 * "Leads Platform" (and "+1" for each further team they lead), else "No team".
 * `allTeams` is false when the list holds only some teams (a manager sees the
 * teams they lead): then a manager or admin who leads none of those may lead
 * another, so it says "—" instead of a wrong "No team".
 * -> { label, kind: 'member' | 'lead' | 'none' | 'unknown' }
 */
export function teamLabel(employee, teams, allTeams = true) {
  if (employee.team_id) return { label: teamName(employee.team_id, teams), kind: 'member' }
  const led = ledTeams(employee.id, teams)
  if (led.length === 0) {
    if (!allTeams && employee.role !== 'employee') return { label: '—', kind: 'unknown' }
    return { label: 'No team', kind: 'none' }
  }
  const more = led.length > 1 ? ` +${led.length - 1}` : ''
  return { label: `Leads ${led[0].name}${more}`, kind: 'lead' }
}
