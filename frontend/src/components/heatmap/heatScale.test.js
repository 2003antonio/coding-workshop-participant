import { describe, expect, it } from 'vitest'
import { HEAT_LEVELS, breakdown, cellLabel, heatLevel, shiftWeek } from './heatScale'

describe('heatLevel: the colour band for a week', () => {
  it.each([
    [0, 'empty'], [1, 'low'], [16, 'low'], [17, 'mid'], [32, 'mid'],
    [33, 'high'], [39, 'high'], [40, 'full'], [48, 'full'],
  ])('%s hours -> %s', (hours, level) => {
    expect(heatLevel(hours)).toBe(level)
  })

  it('treats missing hours as 0', () => {
    expect(heatLevel(undefined)).toBe('empty')
    expect(heatLevel(null)).toBe('empty')
  })

  it('every band has words for the legend', () => {
    expect(HEAT_LEVELS.map((l) => l.label)).toEqual([
      '0 h', '1–16 h', '17–32 h', '33–39 h, near capacity', '40 h or more, full',
    ])
  })
})

describe('words for a cell', () => {
  it('names the person, the week with its year, and the hours', () => {
    expect(cellLabel('Ana Silva', '2026-11-09', 36)).toBe('Ana Silva, week of Nov 9, 2026: 36 hours')
    expect(cellLabel('Bo', '2026-12-28', 1)).toBe('Bo, week of Dec 28, 2026: 1 hour')
  })

  it('lists visible projects, then hidden ones as "Other projects" without names', () => {
    expect(breakdown({ projects: [{ id: 'p', name: 'Billing v2', hours: 20 }], other_hours: 16 }))
      .toEqual(['Billing v2: 20 h', 'Other projects: 16 h'])
    expect(breakdown({ projects: [], other_hours: 0 })).toEqual([])
    expect(breakdown({})).toEqual([])
  })
})

describe('shiftWeek', () => {
  it('moves by whole weeks, across a year end, both ways', () => {
    expect(shiftWeek('2026-11-09', 12)).toBe('2027-02-01')
    expect(shiftWeek('2027-01-04', -1)).toBe('2026-12-28')
  })
})
