// Teams: /api/teams (docs/api-contract.md §3). Writes are admin only.
import { request, seg, toQuery } from './apiClient'

/** GET / -> [team] (admin: all; manager: teams they lead; employee: own team) */
export async function listTeams(accessToken, { includeArchived = false } = {}) {
  const data = await request(`/teams/${toQuery({ include_archived: includeArchived })}`, accessToken)
  return data.teams
}

/** GET /{id} -> team, with members */
export function getTeam(accessToken, id) {
  return request(`/teams/${seg(id)}`, accessToken)
}

/** POST / -> the created team. fields: { name, lead_id } */
export function createTeam(accessToken, fields) {
  return request('/teams/', accessToken, { method: 'POST', body: fields })
}

/** PUT /{id} -> the updated team. changes: any of { name, lead_id } */
export function updateTeam(accessToken, id, changes) {
  return request(`/teams/${seg(id)}`, accessToken, { method: 'PUT', body: changes })
}

/** POST /{id}/members -> the team, with members */
export function addMember(accessToken, teamId, employeeId) {
  return request(`/teams/${seg(teamId)}/members`, accessToken, {
    method: 'POST',
    body: { employee_id: employeeId },
  })
}

/** DELETE /{id}/members/{employee_id} -> the team, with members */
export function removeMember(accessToken, teamId, employeeId) {
  return request(`/teams/${seg(teamId)}/members/${seg(employeeId)}`, accessToken, { method: 'DELETE' })
}

/** POST /{id}/archive -> the archived team */
export function archiveTeam(accessToken, id) {
  return request(`/teams/${seg(id)}/archive`, accessToken, { method: 'POST' })
}
