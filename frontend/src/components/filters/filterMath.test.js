import { describe, expect, it } from 'vitest'
import { MAX_SEARCH, emptyText, matches, optionsFrom, optionsOf, searchTerm } from './filterMath'

describe('filterMath', () => {
  it('searchTerm trims and stops at the server limit', () => {
    expect(searchTerm('  billing  ')).toBe('billing')
    expect(searchTerm('x'.repeat(MAX_SEARCH + 20))).toHaveLength(MAX_SEARCH)
    expect(searchTerm('   ')).toBe('')
  })

  it('matches any field, ignoring case; wildcards are plain text; missing fields are skipped', () => {
    expect(matches('', 'anything')).toBe(true)
    expect(matches('BILL', 'Billing v2')).toBe(true)
    expect(matches('plat', 'Billing v2', null, undefined, 'Platform')).toBe(true)
    expect(matches('50%', 'Cut 50% of cost')).toBe(true)
    expect(matches('5_%', 'Cut 50% of cost')).toBe(false)
    expect(matches('ana', null, undefined)).toBe(false)
    expect(matches('40', 40)).toBe(true)
  })

  it('emptyText says what was searched, else that filters are on, else the plain sentence', () => {
    const none = 'No projects yet.'
    expect(emptyText('projects', { term: 'zz', filtered: true, none })).toBe("No projects match 'zz'.")
    expect(emptyText('projects', { filtered: true, none })).toBe('No projects match these filters.')
    expect(emptyText('projects', { none })).toBe(none)
  })

  it('optionsFrom keeps one option per value, sorted by label, skipping rows without one', () => {
    const rows = [{ team: { id: 't-2', name: 'Data' } }, { team: null }, { team: { id: 't-1', name: 'Apps' } },
      { team: { id: 't-2', name: 'Data' } }]
    expect(optionsFrom(rows, (r) => r.team && { value: r.team.id, label: r.team.name })).toEqual([
      { value: 't-1', label: 'Apps' }, { value: 't-2', label: 'Data' },
    ])
  })

  it('optionsOf keeps the label map order', () => {
    expect(optionsOf({ b: 'Bee', a: 'Ay' })).toEqual([{ value: 'b', label: 'Bee' }, { value: 'a', label: 'Ay' }])
  })
})
