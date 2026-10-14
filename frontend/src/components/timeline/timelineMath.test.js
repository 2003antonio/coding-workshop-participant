import { describe, expect, it } from 'vitest'
import {
  axisTicks, barPosition, dayNumber, dayToDate, flagsFor, percentAt, sentenceFor, spanOf,
} from './timelineMath'

const node = (id, name, start_date, due_date, status = 'not_started') => ({ id, name, start_date, due_date, status })
const API = node('d-1', 'API spec', '2026-11-02', '2026-11-06', 'done')
const BACKEND = node('d-2', 'Backend', '2026-11-09', '2026-12-04', 'in_progress')
const FRONTEND = node('d-3', 'Frontend', '2026-11-02', '2026-11-09')
const CHAIN = {
  nodes: [API, BACKEND, FRONTEND],
  edges: [{ from: 'd-1', to: 'd-2' }, { from: 'd-2', to: 'd-3' }],
  order: ['d-1', 'd-2', 'd-3'],
  longest_chain: ['d-1', 'd-2', 'd-3'],
}

describe('dates as day numbers', () => {
  it('round-trips and never shifts a day', () => {
    expect(dayToDate(dayNumber('2026-12-28'))).toBe('2026-12-28')
    expect(dayNumber('2026-11-03') - dayNumber('2026-11-02')).toBe(1)
    expect(dayNumber('2027-01-01') - dayNumber('2026-12-31')).toBe(1)
  })
})

describe('spanOf and barPosition', () => {
  it('runs from the earliest start to the day after the latest due date', () => {
    const span = spanOf([API, BACKEND, FRONTEND])
    expect(dayToDate(span.start)).toBe('2026-11-02')
    expect(dayToDate(span.end)).toBe('2026-12-05')
    expect(span.days).toBe(33)
    expect(spanOf([])).toBeNull()
  })

  it('places each bar by its dates, including the due day', () => {
    const span = spanOf([API, BACKEND, FRONTEND])
    expect(barPosition(API, span)).toEqual({ left: 0, width: (5 / 33) * 100 })
    const backend = barPosition(BACKEND, span)
    expect(backend.left).toBeCloseTo((7 / 33) * 100)
    expect(backend.left + backend.width).toBeCloseTo(100)
    expect(percentAt(span.end, span)).toBe(100)
  })

  it('a one-day deliverable still has a width', () => {
    const one = node('x', 'One day', '2026-11-02', '2026-11-02')
    expect(barPosition(one, spanOf([one]))).toEqual({ left: 0, width: 100 })
  })
})

describe('axisTicks', () => {
  it('short spans get Mondays, each with the year', () => {
    const ticks = axisTicks(spanOf([API, BACKEND]))
    expect(ticks.map((t) => t.label)).toEqual([
      'Nov 2, 2026', 'Nov 9, 2026', 'Nov 16, 2026', 'Nov 23, 2026', 'Nov 30, 2026',
    ])
    expect(ticks[0].left).toBe(0)
  })

  it('a span starting mid-week starts at the next Monday', () => {
    const ticks = axisTicks(spanOf([node('x', 'X', '2026-12-30', '2027-01-12')]))
    expect(ticks.map((t) => t.label)).toEqual(['Jan 4, 2027', 'Jan 11, 2027'])
  })

  it('long spans get months with the year, across a year end', () => {
    const ticks = axisTicks(spanOf([node('x', 'X', '2026-11-02', '2027-03-31')]))
    expect(ticks.map((t) => t.label)).toEqual(['Dec 2026', 'Jan 2027', 'Feb 2027', 'Mar 2027'])
    expect(ticks.every((t) => t.left > 0 && t.left < 100)).toBe(true)
  })

  it('a span starting on the 1st includes that month; long spans are thinned', () => {
    expect(axisTicks(spanOf([node('x', 'X', '2026-01-01', '2026-03-01')]))[0].label).toBe('Jan 2026')
    const ticks = axisTicks(spanOf([node('x', 'X', '2026-01-01', '2027-12-31')]), 8)
    expect(ticks.length).toBeLessThanOrEqual(8)
    expect(ticks.map((t) => t.label).slice(0, 3)).toEqual(['Jan 2026', 'Apr 2026', 'Jul 2026'])
  })
})

describe('flagsFor', () => {
  it('blocked when something it waits for is not done; overdue when due before today and not done', () => {
    const flags = flagsFor(CHAIN, '2026-11-10')
    expect(flags.get('d-1')).toEqual({ waitsFor: [], blocked: false, overdue: false, onChain: true })
    expect(flags.get('d-2')).toEqual({ waitsFor: ['d-1'], blocked: false, overdue: false, onChain: true })
    expect(flags.get('d-3')).toEqual({ waitsFor: ['d-2'], blocked: true, overdue: true, onChain: true })
  })

  it('a done deliverable is never overdue; a one-item chain is not highlighted', () => {
    const flags = flagsFor({ ...CHAIN, longest_chain: ['d-1'] }, '2027-01-01')
    expect(flags.get('d-1').overdue).toBe(false)
    expect(flags.get('d-1').onChain).toBe(false)
    expect(flags.get('d-2').overdue).toBe(true)
  })
})

describe('sentenceFor', () => {
  const names = new Map(CHAIN.nodes.map((n) => [n.id, n.name]))

  it('says status, flags, dates with the year, what it waits for, and the chain', () => {
    const flags = flagsFor(CHAIN, '2026-11-10')
    expect(sentenceFor(FRONTEND, flags.get('d-3'), names)).toBe(
      'Frontend: not started, overdue, blocked, starts Nov 2, 2026, due Nov 9, 2026, waits for Backend, on the longest chain.')
    expect(sentenceFor(API, flags.get('d-1'), names)).toBe(
      'API spec: done, starts Nov 2, 2026, due Nov 6, 2026, on the longest chain.')
  })

  it('an unknown dependency reads "another deliverable"', () => {
    const flags = { waitsFor: ['gone', 'd-1'], blocked: false, overdue: false, onChain: false }
    expect(sentenceFor(BACKEND, flags, names)).toBe(
      'Backend: in progress, starts Nov 9, 2026, due Dec 4, 2026, waits for another deliverable and API spec.')
  })
})
