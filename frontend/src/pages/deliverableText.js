// Text built from a deliverable 409's structured details (ids), never from server text.

/** Names for ids, in order, for messages built from 409 details. */
export const namesOf = (ids, deliverables) =>
  (ids ?? []).map((id) => deliverables.find((d) => d.id === id)?.name ?? 'another deliverable')

/** The extra line under a 409 that names the deliverables involved (from details, never server text). */
export function dependencyDetails(error, deliverables) {
  if (error?.code === 'dependency_cycle' && error.details?.cycle?.length) {
    return ` Loop: ${namesOf(error.details.cycle, deliverables).join(' → ')}.`
  }
  if (error?.code === 'dependencies_not_done' && error.details?.pending?.length) {
    return ` Still open: ${namesOf(error.details.pending, deliverables).join(', ')}.`
  }
  return null
}
