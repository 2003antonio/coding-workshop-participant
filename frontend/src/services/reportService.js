// Read-only reports: /api/reports (docs/api-contract.md §8). Each covers only
// what the caller may see; money fields follow the budget hiding rule.
import { request, toQuery } from './apiClient'

const get = (name, accessToken, params) => request(`/reports/${name}${toQuery(params)}`, accessToken)

/** 1. -> { projects: [{ ..., deliverables: { total, done, ... }, percent_complete }] } */
export function projectStatus(accessToken, { teamId, status } = {}) {
  return get('project-status', accessToken, { team_id: teamId, status })
}

/** 2. (admin, manager) -> { projects: [{ id, name, team, manager, reasons: [code] }] } */
export function atRiskProjects(accessToken) {
  return get('at-risk-projects', accessToken)
}

/** 3. -> { weeks: [week_start], people: [{ id, name, team_id, weeks: [...] }] } */
export function resourceAllocation(accessToken, { from, to, teamId } = {}) {
  return get('resource-allocation', accessToken, { from, to, team_id: teamId })
}

/** 4. -> { deliverables: [{ id, name, project, status, due_date, overdue, blocked, blocking }] } */
export function deliverableStatus(accessToken, { projectId, status, overdue } = {}) {
  return get('deliverable-status', accessToken, { project_id: projectId, status, overdue })
}

/** 5. (admin, manager) -> { label, threshold, people: [{ id, name, weeks: [{ week_start, total_hours }] }] } */
export function overAllocated(accessToken, { from, to, threshold } = {}) {
  return get('over-allocated', accessToken, { from, to, threshold })
}

/** 6. -> { project_id, nodes, edges, order, longest_chain }. projectId is required. */
export function dependencyChain(accessToken, { projectId, deliverableId } = {}) {
  return get('dependency-chain', accessToken, { project_id: projectId, deliverable_id: deliverableId })
}

/** 7. (admin, manager) -> { projects: [{ ..., planned, used, remaining, percent_used, hidden_reason }],
 *  teams: [{ id, name, weekly, yearly, hidden_reason }] } */
export function budgetReport(accessToken, { teamId } = {}) {
  return get('budget', accessToken, { team_id: teamId })
}
