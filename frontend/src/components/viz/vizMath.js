// Small pure helpers behind the shared charts and badges (components/viz/).
import { AVATAR_COLORS } from '../../theme'

/**
 * The same number for the same text, every time: FNV-1a with a final mix, so
 * names that differ only near the end still land on different colours. The
 * seed was picked so the demo projects, teams and Platform people all differ.
 */
export function hashText(text = '') {
  let hash = 912881691
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  hash ^= hash >>> 15
  hash = Math.imul(hash, 0x2c1b3c6d)
  hash ^= hash >>> 12
  return hash >>> 0
}

/** Index into AVATAR_COLORS for a name: the same person or project always gets the same colour. */
export const colorIndex = (key) => hashText(String(key ?? '')) % AVATAR_COLORS.light.length

/** sx with the avatar colour for `key`, in both modes. */
export const avatarColorSx = (key) => (theme) => {
  const i = colorIndex(key)
  return {
    color: AVATAR_COLORS.light[i].fg,
    bgcolor: AVATAR_COLORS.light[i].bg,
    ...theme.applyStyles('dark', { color: AVATAR_COLORS.dark[i].fg, bgcolor: AVATAR_COLORS.dark[i].bg }),
  }
}

/**
 * sx that draws `data-initials` as CSS content: the letters show, but they are
 * not part of the element's text, so a row's text (and a copy-paste) is just the name.
 */
export const initialsSx = { '&::after': { content: 'attr(data-initials)' } }

/** "Ana Silva" -> "AS", "Billing v2" -> "BV", "Platform" -> "PL". */
export function initials(name = '') {
  const words = String(name).trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

const DAY = 86400000

/** Whole days from `today` to `date` (both YYYY-MM-DD calendar days): 3 = in 3 days, -2 = 2 days ago. */
export function daysUntil(date, today) {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY)
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * What a due date means today: { text, tone }.
 *   done -> "Done"; past -> "2 days overdue"; today -> "Due today"; later -> "Due in 3 days".
 * tone is a STATUS_COLORS name: overdue, blocked (due within 3 days), not_started or done.
 */
export function dueInfo(due, today, done = false) {
  if (done) return { text: 'Done', tone: 'done' }
  const days = daysUntil(due, today)
  if (days < 0) return { text: `${plural(-days, 'day')} overdue`, tone: 'overdue' }
  if (days === 0) return { text: 'Due today', tone: 'blocked' }
  if (days === 1) return { text: 'Due tomorrow', tone: 'blocked' }
  return { text: `Due in ${plural(days, 'day')}`, tone: days <= 3 ? 'blocked' : 'not_started' }
}

/** "rising", "falling" or "flat": the last value against the first (a change within 5% of the range is flat). */
export function trendOf(values) {
  if (values.length < 2) return 'flat'
  const first = values[0]
  const last = values[values.length - 1]
  const range = Math.max(...values) - Math.min(...values)
  if (range === 0 || Math.abs(last - first) <= range * 0.05) return 'flat'
  return last > first ? 'rising' : 'falling'
}

const TREND_WORDS = { rising: 'rising', falling: 'falling', flat: 'steady' }

/** "Hours per week, next 8 weeks: from 20 h to 36 h, rising; lowest 20 h, highest 36 h." */
export function sparklineSentence(values, { what, unit = '' }) {
  if (values.length === 0) return `${what}: no data.`
  const u = (n) => `${n}${unit}`
  return `${what}: from ${u(values[0])} to ${u(values[values.length - 1])}, ${TREND_WORDS[trendOf(values)]}; `
    + `lowest ${u(Math.min(...values))}, highest ${u(Math.max(...values))}.`
}

/** Screen-reader-only text: read out, but it takes no space and never widens the page. */
export const visuallyHidden = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden',
  clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
}
