import { Suspense } from 'react'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PageSkeleton } from './components/PageState'
import { PROTECTED_ROUTES, PUBLIC_ROUTES, lazyPage } from './routes'

/** A page whose code arrives only when the test says so. */
function slowPage() {
  let arrive
  const Page = lazyPage(() => new Promise((resolve) => {
    arrive = () => resolve({ default: () => <h1>Slow page</h1> })
  }))
  return { Page, arrive: () => arrive() }
}

const show = (Page) => render(<Suspense fallback={<PageSkeleton />}><Page /></Suspense>)

describe('lazy routes', () => {
  it('show the page skeleton first, then the page', async () => {
    const { Page, arrive } = slowPage()
    show(Page)
    expect(screen.getByRole('status', { name: 'Loading page' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('heading', { name: 'Slow page' })).not.toBeInTheDocument()

    await act(async () => arrive())
    expect(await screen.findByRole('heading', { name: 'Slow page' })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: /^Loading/ })).not.toBeInTheDocument()
  })

  it('once loaded (or preloaded), a page shows at once with no skeleton', async () => {
    const { Page, arrive } = slowPage()
    const preload = Page.preload()
    arrive()
    await preload
    show(Page)
    expect(screen.getByRole('heading', { name: 'Slow page' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('every route is lazy and can be preloaded', () => {
    for (const { Page } of [...PUBLIC_ROUTES, ...PROTECTED_ROUTES]) {
      expect(Page.$$typeof).toBe(Symbol.for('react.lazy'))
      expect(typeof Page.preload).toBe('function')
    }
  })
})
