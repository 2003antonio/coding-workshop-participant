// Default dates for a new deliverable (DeliverableFormDialog).
import { localToday } from './home/homeMath'

/**
 * The first day offered for a new deliverable: today on this computer (local
 * time, so late in the evening is still today, not tomorrow in UTC), moved
 * inside the project's dates when today is outside them.
 */
export function defaultStartDate(project, today = localToday()) {
  if (today < project.start_date) return project.start_date
  if (today > project.end_date) return project.end_date
  return today
}
