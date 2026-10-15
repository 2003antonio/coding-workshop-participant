// Search and filter rules shared by every list (the Projects page searches on the
// server with the same rules, docs/api-contract.md §4; the other lists arrive whole
// and are filtered here).

/** The server's limit for search text (§4); the boxes stop there too. */
export const MAX_SEARCH = 100
/** Wait this long after the last key before a server-side search. */
export const SEARCH_DELAY_MS = 300

/** What a search box holds, as matched: trimmed, cut to MAX_SEARCH ('' = no search). */
export const searchTerm = (raw) => raw.trim().slice(0, MAX_SEARCH)

/**
 * True when `term` is empty or one of `fields` contains it: case-insensitive, as a
 * plain substring (like the server's q, where wildcards are literal). Missing fields are skipped.
 */
export function matches(term, ...fields) {
  if (!term) return true
  const needle = term.toLowerCase()
  return fields.some((field) => field !== null && field !== undefined && String(field).toLowerCase().includes(needle))
}

/**
 * The sentence for an empty list: what was searched, else that filters are on, else `none`.
 *   emptyText('projects', { term: 'x', none: 'No projects yet.' }) -> "No projects match 'x'."
 */
export function emptyText(plural, { term = '', filtered = false, none }) {
  if (term) return `No ${plural} match '${term}'.`
  if (filtered) return `No ${plural} match these filters.`
  return none
}

/** Distinct { value, label } options from `rows` (e.g. the teams in a report), sorted by label. */
export function optionsFrom(rows, pick) {
  const byValue = new Map()
  for (const row of rows) {
    const option = pick(row)
    if (option && !byValue.has(option.value)) byValue.set(option.value, option.label)
  }
  return [...byValue].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
}

/** { value: label } (e.g. PROJECT_STATUS in pages/format.js) as dropdown options, in that order. */
export const optionsOf = (labels) => Object.entries(labels).map(([value, label]) => ({ value, label }))

/**
 * `value` if it is one of `options`, else '' (no filter): a value from the address that
 * names no option (a team you can't see, or not loaded yet) never filters or shows.
 */
export const chosen = (value, options) => (options.some((o) => o.value === value) ? value : '')
