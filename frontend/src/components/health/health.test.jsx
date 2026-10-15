import { describe, expect, it } from 'vitest'
import { peopleSentence, peopleThisWeek, scheduleCounts, scheduleSentence } from './healthMath'

const d = (status, flags = {}) => ({ status, overdue: false, blocked: false, ...flags })
const a = (name, hours, start, end) => ({ employee: { name }, hours_per_week: hours, start_date: start, end_date: end })

describe('health strip numbers', () => {
  it('counts each deliverable once and says it in a sentence', () => {
    const counts = scheduleCounts([
      d('done'), d('done'), d('in_progress', { overdue: true, blocked: true }), d('not_started', { blocked: true }),
      d('in_progress'), d('not_started'),
    ])
    expect(counts).toEqual({ done: 2, overdue: 1, blocked: 1, in_progress: 1, not_started: 1 })
    expect(scheduleSentence(counts)).toBe('2 of 6 done, 1 overdue, 1 blocked.')
    expect(scheduleSentence(scheduleCounts([]))).toBe('Nothing scheduled yet.')
  })

  it('adds the hours of assignments that touch this week (Wednesday Oct 14, 2026)', () => {
    const week = peopleThisWeek([
      a('Ana Silva', 20, '2026-10-01', '2026-12-31'),
      a('Bo Chen', 16, '2026-10-18', '2026-11-30'), // starts Sunday: counts
      a('Eve Employee', 10, '2026-10-19', '2026-11-30'), // starts next week
      a('Ana Silva', 4, '2026-09-01', '2026-10-12'), // ended Monday: counts
    ], '2026-10-14')
    expect(week).toEqual({ names: ['Ana Silva', 'Bo Chen', 'Eve Employee'], hoursThisWeek: 40 })
    expect(peopleSentence(week)).toBe('3 people, 40 h this week')
    expect(peopleSentence({ names: ['Eve Employee'], hoursThisWeek: 20 }, true)).toBe('You, 20 h this week')
  })
})
