import { describe, expect, it } from 'vitest'
import { ApiError } from './apiClient'
import { detailsSentence, loopSentence, namesOf, pendingSentence, weeksOverSentence } from './errorDetails'

const deliverables = [
  { id: 'd-1', name: 'Pay API' },
  { id: 'd-2', name: 'Billing UI' },
  { id: 'd-3', name: 'QA sign-off' },
]

describe('weeksOverSentence', () => {
  it('names every week and its hours, in the order the server sent them', () => {
    expect(weeksOverSentence([{ week_start: '2026-10-26', hours: 45 }, { week_start: '2026-11-02', hours: 45 }]))
      .toBe('Over 40 hours in: week of Oct 26, 2026 (45 h), week of Nov 2, 2026 (45 h)')
  })

  it('reads the Monday as a calendar day, so it never shifts across a time zone or a year', () => {
    expect(weeksOverSentence([{ week_start: '2026-12-28', hours: 41 }, { week_start: '2027-01-04', hours: 48 }]))
      .toBe('Over 40 hours in: week of Dec 28, 2026 (41 h), week of Jan 4, 2027 (48 h)')
  })

  it('is null without weeks', () => {
    expect(weeksOverSentence([])).toBeNull()
    expect(weeksOverSentence(undefined)).toBeNull()
  })
})

describe('loopSentence', () => {
  it('turns the ids into names and closes the loop on the first one', () => {
    expect(loopSentence(['d-1', 'd-2'], deliverables)).toBe('Loop: Pay API -> Billing UI -> Pay API')
    expect(loopSentence(['d-3', 'd-1', 'd-2'], deliverables))
      .toBe('Loop: QA sign-off -> Pay API -> Billing UI -> QA sign-off')
  })

  it('an id that is not loaded reads "another deliverable", never the raw id', () => {
    expect(loopSentence(['d-1', 'd-9'], deliverables)).toBe('Loop: Pay API -> another deliverable -> Pay API')
  })

  it('is null without a cycle', () => {
    expect(loopSentence([], deliverables)).toBeNull()
    expect(loopSentence(null, deliverables)).toBeNull()
  })
})

describe('pendingSentence and namesOf', () => {
  it('lists the open dependencies by name', () => {
    expect(pendingSentence(['d-1', 'd-3'], deliverables)).toBe('Still open: Pay API, QA sign-off')
    expect(pendingSentence([], deliverables)).toBeNull()
  })

  it('namesOf keeps the order and copes with no list', () => {
    expect(namesOf(['d-2', 'd-1'], deliverables)).toEqual(['Billing UI', 'Pay API'])
    expect(namesOf(undefined, deliverables)).toEqual([])
    expect(namesOf(['d-1'])).toEqual(['another deliverable'])
  })
})

describe('detailsSentence', () => {
  it('picks the sentence by error code', () => {
    const weeks = [{ week_start: '2026-11-16', hours: 46 }]
    expect(detailsSentence(new ApiError(409, 'over_allocated', { weeks })))
      .toBe('Over 40 hours in: week of Nov 16, 2026 (46 h)')
    expect(detailsSentence(new ApiError(409, 'dependency_cycle', { cycle: ['d-2', 'd-1'] }), { deliverables }))
      .toBe('Loop: Billing UI -> Pay API -> Billing UI')
    expect(detailsSentence(new ApiError(409, 'dependencies_not_done', { pending: ['d-1'] }), { deliverables }))
      .toBe('Still open: Pay API')
  })

  it('is null for other errors, missing details or no error', () => {
    expect(detailsSentence(new ApiError(409, 'over_allocated'))).toBeNull()
    expect(detailsSentence(new ApiError(409, 'dependency_cycle'), { deliverables })).toBeNull()
    expect(detailsSentence(new ApiError(409, 'archived', { weeks: [{ week_start: '2026-11-16', hours: 46 }] })))
      .toBeNull()
    expect(detailsSentence(null)).toBeNull()
  })
})
