// Closing a project frees its people first (Close project, People tab notice).
// The server refuses allocation edits once a project is completed (allocations
// _check_open_project), so assignments are ended BEFORE the status changes.
import { messageFor } from '../pages/apiMessages'
import * as allocationService from '../services/allocationService'

/** Active assignments that run past `today` (YYYY-MM-DD, local); one ending today is already freed. */
export const stillAssigned = (allocations, today) =>
  allocations.filter((a) => !a.archived_at && a.end_date > today)

/** { people, hours, text: "3 people, 70 h per week" } for those assignments. */
export function assignedSummary(rows) {
  const people = new Set(rows.map((a) => a.employee.id)).size
  const hours = rows.reduce((sum, a) => sum + a.hours_per_week, 0)
  return { people, hours, text: `${people} ${people === 1 ? 'person' : 'people'}, ${hours} h per week` }
}

/**
 * End each assignment today: one that has started gets end date today, one that has
 * not started yet is removed (archived). Stops at the first refusal and throws an
 * error whose `sentence` names the person; nothing after it is changed.
 */
export async function endAssignments(api, rows, today) {
  for (const a of rows) {
    try {
      if (a.start_date > today) {
        await api((token) => allocationService.archiveAllocation(token, a.id))
      } else {
        await api((token) => allocationService.updateAllocation(token, a.id, { end_date: today }))
      }
    } catch (error) {
      error.sentence = `${a.employee.name}'s assignment could not be ended: ${messageFor(error)} `
        + 'The project was not closed.'
      throw error
    }
  }
}
