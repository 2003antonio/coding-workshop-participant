// Projects and their deliverables: /api/projects (docs/api-contract.md §4-5).
import { request, seg, toQuery } from './apiClient'

const project = (id) => `/projects/${seg(id)}`
const deliverables = (projectId) => `${project(projectId)}/deliverables/`
const deliverable = (projectId, id) => `${project(projectId)}/deliverables/${seg(id)}`

/** GET /?team_id=&status=&include_archived= -> [project], filtered by what the caller may see */
export async function listProjects(accessToken, { teamId, status, includeArchived = false } = {}) {
  const query = toQuery({ team_id: teamId, status, include_archived: includeArchived })
  const data = await request(`/projects/${query}`, accessToken)
  return data.projects
}

/** GET /{id} -> project */
export function getProject(accessToken, id) {
  return request(project(id), accessToken)
}

/** POST / -> the created project.
 *  fields: { team_id, name, description?, status?, start_date, end_date, planned_budget? } */
export function createProject(accessToken, fields) {
  return request('/projects/', accessToken, { method: 'POST', body: fields })
}

/** PUT /{id} -> the updated project. changes: any of name, description, status, start_date,
 *  end_date, planned_budget (null clears it); team_id admin only */
export function updateProject(accessToken, id, changes) {
  return request(project(id), accessToken, { method: 'PUT', body: changes })
}

/** POST /{id}/archive -> the archived project (its deliverables and allocations go with it) */
export function archiveProject(accessToken, id) {
  return request(`${project(id)}/archive`, accessToken, { method: 'POST' })
}

/** GET /{project_id}/deliverables/ -> [deliverable] */
export async function listDeliverables(accessToken, projectId) {
  const data = await request(deliverables(projectId), accessToken)
  return data.deliverables
}

/** POST /{project_id}/deliverables/ -> the created deliverable.
 *  fields: { name, description?, start_date, due_date, depends_on?: [ids] } */
export function createDeliverable(accessToken, projectId, fields) {
  return request(deliverables(projectId), accessToken, { method: 'POST', body: fields })
}

/** PUT /{project_id}/deliverables/{id} -> the updated deliverable.
 *  changes: any of name, description, start_date, due_date, status */
export function updateDeliverable(accessToken, projectId, id, changes) {
  return request(deliverable(projectId, id), accessToken, { method: 'PUT', body: changes })
}

/** PUT /{project_id}/deliverables/{id}/dependencies -> the deliverable. Replaces the whole set. */
export function setDependencies(accessToken, projectId, id, dependsOn) {
  return request(`${deliverable(projectId, id)}/dependencies`, accessToken, {
    method: 'PUT',
    body: { depends_on: dependsOn },
  })
}

/** POST /{project_id}/deliverables/{id}/archive -> the archived deliverable */
export function archiveDeliverable(accessToken, projectId, id) {
  return request(`${deliverable(projectId, id)}/archive`, accessToken, { method: 'POST' })
}
