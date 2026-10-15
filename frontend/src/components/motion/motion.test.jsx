import { act, render, renderHook, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { signedInAs } from '../../test/fakeApiServer'
import { renderApp } from '../../test/renderApp'
import DependencyTimeline from '../timeline/DependencyTimeline'
import { MOTION, motionSx, usePrefersReducedMotion } from './motion'

/** Pretend the computer's "reduce motion" setting is on or off; returns a switch for it. */
function reduceMotion(on) {
  const listeners = new Set()
  const media = {
    matches: on,
    addEventListener: (type, fn) => listeners.add(fn),
    removeEventListener: (type, fn) => listeners.delete(fn),
  }
  // Screen-size queries (react-responsive) get "no", so pages render at desktop width.
  const other = () => ({
    matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
  })
  vi.stubGlobal('matchMedia', vi.fn((query) => (query.includes('prefers-reduced-motion') ? media : other())))
  return (next) => {
    media.matches = next
    listeners.forEach((fn) => fn())
  }
}

const animationOf = (el) => getComputedStyle(el).animation

describe('motionSx: the one shared helper', () => {
  it('returns no animation props at all when motion is reduced', () => {
    for (const kind of ['enter', 'fade', 'grow', 'unknown']) {
      expect(motionSx(true, kind, 3)).toEqual({})
    }
  })

  it('keeps every animation short, staggering only the first few items', () => {
    expect(motionSx(false, 'grow', 2)).toEqual({
      transformOrigin: 'left center', animation: expect.stringMatching(/ 200ms ease-out 50ms both$/),
    })
    expect(motionSx(false, 'fade', 99).animation).toMatch(/ 200ms ease-out 100ms both$/) // capped
    expect(motionSx(false, 'enter', -1).animation).toMatch(/ 0ms both$/)
    expect(motionSx(false, 'nope').animation).toBe(motionSx(false, 'enter').animation)
    expect(MOTION.duration + MOTION.maxStaggered * MOTION.stagger).toBeLessThanOrEqual(300)
  })
})

describe('usePrefersReducedMotion', () => {
  it('follows the setting, live', () => {
    const toggle = reduceMotion(false)
    const { result } = renderHook(() => usePrefersReducedMotion())
    expect(result.current).toBe(false)
    act(() => toggle(true))
    expect(result.current).toBe(true)
  })

  it('is off when the browser cannot tell', () => {
    const { result } = renderHook(() => usePrefersReducedMotion())
    expect(result.current).toBe(false) // jsdom has no matchMedia
  })
})

const CHAIN = {
  nodes: [{ id: 'a', name: 'A', status: 'done', start_date: '2026-11-02', due_date: '2026-11-06' }],
  edges: [], order: ['a'], longest_chain: ['a'],
}

describe('what moves on screen', () => {
  it('with motion allowed: the page fades in, tabs fade in, bars grow', async () => {
    signedInAs('manager')
    const { user } = renderApp('/projects/p-1')
    await screen.findByRole('table', { name: 'Deliverables' })
    const page = screen.getByTestId('page-transition')
    expect(animationOf(page)).toMatch(/150ms ease-out 0ms both/)
    expect(animationOf(screen.getByRole('tabpanel'))).toMatch(/200ms/)

    render(<DependencyTimeline chain={CHAIN} today="2026-11-10" />)
    expect(animationOf(screen.getByRole('img', { name: /^A:/ }))).toMatch(/200ms/)

    // A new page gets a new wrapper, so the fade plays again.
    await user.click(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'Projects' }))
    await screen.findByRole('heading', { level: 1, name: 'Projects' })
    expect(screen.getByTestId('page-transition')).not.toBe(page)
  })

  it('with reduced motion on, no animation props are applied anywhere', async () => {
    reduceMotion(true)
    signedInAs('manager')
    const { user } = renderApp('/projects/p-1')
    await screen.findByRole('table', { name: 'Deliverables' })
    expect(animationOf(screen.getByTestId('page-transition'))).toBe('')
    expect(animationOf(screen.getByRole('tabpanel'))).toBe('')

    await user.click(screen.getByRole('tab', { name: 'Dependencies' }))
    const chart = await screen.findByRole('group', { name: 'Dependency timeline' })
    for (const bar of within(chart).getAllByRole('img')) expect(animationOf(bar)).toBe('')

    render(<DependencyTimeline chain={CHAIN} today="2026-11-10" isPhone />)
    const card = within(screen.getAllByRole('list', { name: 'Deliverables in dependency order' }).at(-1)).getByRole('listitem')
    expect(animationOf(card)).toBe('')
  })

  it('with reduced motion on, heat-map rows do not fade', async () => {
    reduceMotion(true)
    signedInAs('manager')
    renderApp('/reports?report=resources')
    const table = await screen.findByRole('table', { name: 'Resource allocation' })
    for (const row of within(table).getAllByRole('row')) expect(animationOf(row)).toBe('')
  })
})
