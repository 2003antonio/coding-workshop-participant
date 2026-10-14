// Team and project budgets (docs/api-contract.md §7). Below MIN_AGGREGATE_GROUP
// a non-admin gets every money field as null and hidden_reason "below_min_group".
// Per-person lines (with hourly rates) come back for admins only.
import { request, seg } from './apiClient'

/** GET /api/teams/{id}/budget -> { team_id, member_count, weekly, yearly, hidden_reason } */
export function getTeamBudget(accessToken, teamId) {
  return request(`/teams/${seg(teamId)}/budget`, accessToken)
}

/** GET /api/projects/{id}/budget ->
 *  { project_id, planned, used, remaining, allocated_people, hidden_reason, lines? } */
export function getProjectBudget(accessToken, projectId) {
  return request(`/projects/${seg(projectId)}/budget`, accessToken)
}
