import { act, fireEvent, render, screen, waitFor, waitForElementToBeRemoved, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { reply, signedInAs } from '../../test/fakeApiServer'
import { renderApp } from '../../test/renderApp'
import ToastProvider, { TOAST_MS } from './ToastProvider'
import { useToast } from './toast'

function Saver() {
  const toast = useToast()
  return (
    <>
      <button type="button" onClick={() => toast('Project created: Billing v2')}>first</button>
      <button type="button" onClick={() => toast('Team updated: Platform')}>second</button>
    </>
  )
}

describe('ToastProvider', () => {
  it('shows one polite message at a time and closes on Dismiss', async () => {
    const user = userEvent.setup()
    render(<ToastProvider><Saver /></ToastProvider>)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'first' }))
    const toast = screen.getByRole('status')
    expect(toast).toHaveTextContent('Project created: Billing v2')
    expect(toast).toHaveAttribute('aria-live', 'polite')

    // A newer message replaces the one on screen.
    await user.click(screen.getByRole('button', { name: 'second' }))
    await waitFor(() => expect(screen.getAllByRole('status')).toHaveLength(1))
    expect(screen.getByRole('status')).toHaveTextContent('Team updated: Platform')

    await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Dismiss' }))
    await waitForElementToBeRemoved(() => screen.queryByRole('status'))
  })

  it('goes away by itself after a few seconds', () => {
    vi.useFakeTimers()
    try {
      render(<ToastProvider><Saver /></ToastProvider>)
      fireEvent.click(screen.getByRole('button', { name: 'first' }))
      expect(screen.getByRole('status')).toBeInTheDocument()
      act(() => vi.advanceTimersByTime(TOAST_MS - 500))
      expect(screen.getByRole('status')).toBeInTheDocument()
      act(() => vi.advanceTimersByTime(1000))
      act(() => vi.advanceTimersByTime(1000))
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a deliverable archive shows a toast; a refused one keeps its inline sentence and shows none', async () => {
    signedInAs('manager', {
      routes: { 'POST /api/projects/p-1/deliverables/d-2/archive': () => reply(409, { error: { code: 'already_archived', message: 'raw' } }) },
    })
    const { user } = renderApp('/projects/p-1')
    await screen.findByRole('table', { name: 'Deliverables' })

    await user.click(screen.getByRole('button', { name: 'Archive Backend' }))
    let dialog = await screen.findByRole('dialog', { name: 'Archive Backend?' })
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }))
    expect(await within(dialog).findByText('That is already archived.')).toBeInTheDocument()
    expect(screen.queryByText(/Deliverable archived/)).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: 'Archive Frontend' }))
    dialog = await screen.findByRole('dialog', { name: 'Archive Frontend?' })
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }))
    const toast = await screen.findByRole('status', {}, { timeout: 3000 })
    expect(toast).toHaveTextContent('Deliverable archived: Frontend')
  })
})
