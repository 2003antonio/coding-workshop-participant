import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LoadState, LoadingSkeleton } from './PageState'

describe('LoadingSkeleton', () => {
  it.each(['cards', 'table', 'list', 'chart', 'detail'])('%s is a busy status named "Loading ..."', (variant) => {
    render(<LoadingSkeleton variant={variant} label={`Loading ${variant}`} />)
    const status = screen.getByRole('status', { name: `Loading ${variant}` })
    expect(status).toHaveAttribute('aria-busy', 'true')
    // The grey shapes are decoration: hidden from screen readers.
    expect(status.firstChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('falls back to a list and a plain "Loading" name', () => {
    render(<LoadingSkeleton variant="nope" />)
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })
})

describe('LoadState', () => {
  const ready = (data) => ({ status: 'ready', data, error: '', reload: vi.fn() })

  it('shows the chosen skeleton while loading, or a spinner without one', () => {
    const loading = { status: 'loading', reload: vi.fn() }
    const { rerender } = render(<LoadState result={loading} label="Loading teams" skeleton="table">{() => 'x'}</LoadState>)
    expect(screen.getByRole('status', { name: 'Loading teams' })).toHaveAttribute('aria-busy', 'true')
    rerender(<LoadState result={loading} label="Loading teams">{() => 'x'}</LoadState>)
    expect(screen.getByRole('status', { name: 'Loading teams' })).not.toHaveAttribute('aria-busy')
  })

  it('shows the friendly error with "Try again", then the data when ready', async () => {
    const failed = { status: 'error', error: 'We could not load this.', reload: vi.fn() }
    const { rerender } = render(<LoadState result={failed} label="Loading">{() => 'data'}</LoadState>)
    expect(screen.getByText('We could not load this.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(failed.reload).toHaveBeenCalledTimes(1)
    rerender(<LoadState result={ready(['a'])} label="Loading">{(data) => `got ${data[0]}`}</LoadState>)
    expect(screen.getByText('got a')).toBeInTheDocument()
  })
})
