// Pure helpers for the capacity heat-map (report 3, docs/api-contract.md §8):
// which colour band a week's hours fall in, and the words for each cell.
import { formatWeek } from '../../pages/format'

/**
 * The bands, lowest first. `max` is inclusive; the last band has no top.
 * Colours come from theme tokens whose text/background pairs pass 4.5:1
 * (theme.js STATUS_COLORS and primary/contrastText), so the number stays readable.
 */
export const HEAT_LEVELS = [
  { key: 'empty', max: 0, label: '0 h' },
  { key: 'low', max: 16, label: '1–16 h' },
  { key: 'mid', max: 32, label: '17–32 h' },
  { key: 'high', max: 39, label: '33–39 h, near capacity' },
  { key: 'full', max: Infinity, label: '40 h or more, full' },
]

/** 0 -> 'empty', 1-16 -> 'low', 17-32 -> 'mid', 33-39 -> 'high' (amber), 40+ -> 'full' (red). */
export function heatLevel(hours) {
  const h = Number(hours) || 0
  return HEAT_LEVELS.find((level) => h <= level.max).key
}

/** "Ana Silva, week of Nov 9, 2026: 36 hours" (the cell's accessible name). */
export function cellLabel(name, weekStart, hours) {
  return `${name}, ${formatWeek(weekStart)}: ${hours} ${hours === 1 ? 'hour' : 'hours'}`
}

/** One line per project the caller can see, then the rest as "Other projects". */
export function breakdown(week) {
  const lines = (week.projects ?? []).map((p) => `${p.name}: ${p.hours} h`)
  if (week.other_hours) lines.push(`Other projects: ${week.other_hours} h`)
  return lines
}

/** "2026-11-09" moved by n weeks (n may be negative). */
export function shiftWeek(date, weeks) {
  const time = Date.parse(`${date}T00:00:00Z`) + weeks * 7 * 86400000
  return new Date(time).toISOString().slice(0, 10)
}
