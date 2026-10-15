// The Activity feed: GET /api/reports/activity (docs/api-contract.md §8, report 8).
// Admin and manager only. Rows carry a server-built sentence and never an amount.
import { request, toQuery } from './apiClient'

/** The filter values the server accepts for `type`. */
export const ACTIVITY_TYPES = ['people', 'teams', 'projects', 'deliverables', 'assignments', 'sign-ins']

/**
 * -> { activity: [{ id, occurred_at, actor: { id, name, role } | null, action, type,
 *      entity_type, entity_id, sentence }], total, limit, offset }   (newest first)
 */
export function listActivity(accessToken, { type, limit, offset } = {}) {
  return request(`/reports/activity${toQuery({ type, limit, offset })}`, accessToken)
}
