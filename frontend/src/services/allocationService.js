// Allocations (people assigned to projects): /api/allocations (docs/api-contract.md §6).
// Only admin responses carry hourly_rate and weekly_cost.
import { request, seg, toQuery } from './apiClient'

/** GET /?project_id=&employee_id=&from=&to=&include_archived= -> [allocation] */
export async function listAllocations(
  accessToken,
  { projectId, employeeId, from, to, includeArchived = false } = {},
) {
  const query = toQuery({
    project_id: projectId, employee_id: employeeId, from, to, include_archived: includeArchived,
  })
  const data = await request(`/allocations/${query}`, accessToken)
  return data.allocations
}

/** POST / -> the created allocation.
 *  fields: { employee_id, project_id, hours_per_week, start_date, end_date }
 *  A 409 over_allocated error carries details.weeks: [{ week_start, hours }]. */
export function createAllocation(accessToken, fields) {
  return request('/allocations/', accessToken, { method: 'POST', body: fields })
}

/** PUT /{id} -> the updated allocation. changes: any of hours_per_week, start_date, end_date */
export function updateAllocation(accessToken, id, changes) {
  return request(`/allocations/${seg(id)}`, accessToken, { method: 'PUT', body: changes })
}

/** POST /{id}/archive -> the archived allocation (this is how someone is removed) */
export function archiveAllocation(accessToken, id) {
  return request(`/allocations/${seg(id)}/archive`, accessToken, { method: 'POST' })
}
