import { describe, expect, it } from 'vitest'
import { formatWeek, formatWeekShort } from './format'

describe('week labels always carry the year', () => {
  it('long form: "week of Dec 28, 2026"', () => {
    expect(formatWeek('2026-12-28')).toBe('week of Dec 28, 2026')
    expect(formatWeek('2026-11-09')).toMatch(/2026$/)
  })

  it('a December-to-January run of weeks shows the right year on each', () => {
    expect(['2026-12-21', '2026-12-28', '2027-01-04'].map(formatWeek))
      .toEqual(['week of Dec 21, 2026', 'week of Dec 28, 2026', 'week of Jan 4, 2027'])
    expect(['2026-12-28', '2027-01-04'].map(formatWeekShort)).toEqual(['Dec 28 ’26', 'Jan 4 ’27'])
  })

  it('reads the Monday as a calendar day, never shifted by the time zone', () => {
    expect(formatWeek('2027-01-04')).not.toMatch(/Jan 3/)
    expect(formatWeekShort('2026-01-05')).toBe('Jan 5 ’26')
  })

  it('shows a dash when there is no week', () => {
    expect(formatWeek(null)).toBe('—')
    expect(formatWeekShort(undefined)).toBe('—')
  })
})
