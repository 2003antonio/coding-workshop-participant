import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import InlineEditCell from './InlineEditCell'

function setup(props = {}) {
  const user = userEvent.setup()
  const onSave = props.onSave ?? vi.fn().mockResolvedValue(undefined)
  const view = render(<InlineEditCell value="Backend" what="name of Backend" onSave={onSave} {...props} />)
  const rerender = (next) => view.rerender(<InlineEditCell value="Backend" what="name of Backend" onSave={onSave} {...props} {...next} />)
  return { user, onSave, rerender }
}
const button = (name = /^Backend, change name of Backend$/) => screen.getByRole('button', { name })
const field = () => screen.getByRole('textbox', { name: 'Change name of Backend' })

describe('InlineEditCell', () => {
  it('is plain text for people who may not change it', () => {
    render(<InlineEditCell value="Backend" what="name" canEdit={false} onSave={vi.fn()} />)
    expect(screen.getByText('Backend')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('is a real button until clicked, then a field with the value', async () => {
    const { user } = setup()
    expect(button()).toHaveTextContent('Backend')
    await user.click(button())
    expect(field()).toHaveValue('Backend')
    expect(field()).toHaveFocus()
    expect(screen.getByText('Enter saves, Escape cancels')).toBeInTheDocument()
  })

  it('Escape cancels: nothing is saved, the old value and the focus come back', async () => {
    const { user, onSave } = setup()
    await user.click(button())
    await user.clear(field())
    await user.type(field(), 'Server{Escape}')
    expect(onSave).not.toHaveBeenCalled()
    expect(button()).toHaveTextContent('Backend')
    await waitFor(() => expect(button()).toHaveFocus())
  })

  it('Enter saves the trimmed value and shows it at once', async () => {
    let finish
    const onSave = vi.fn(() => new Promise((resolve) => { finish = resolve }))
    const { user, rerender } = setup({ onSave })
    await user.click(button())
    await user.clear(field())
    await user.type(field(), '  Server  {Enter}')
    expect(onSave).toHaveBeenCalledWith('Server')
    const saving = screen.getByRole('button', { name: /^Server, change/ })
    expect(saving).toHaveAttribute('aria-busy', 'true')
    finish()
    rerender({ value: 'Server' }) // the list reloads with the saved value
    await waitFor(() => expect(screen.getByRole('button', { name: /^Server, change/ })).not.toHaveAttribute('aria-busy'))
  })

  it('a refusal rolls the value back', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('over_allocated'))
    const { user } = setup({ onSave })
    await user.click(button())
    await user.clear(field())
    await user.type(field(), 'Server{Enter}')
    expect(onSave).toHaveBeenCalledWith('Server')
    await waitFor(() => expect(button()).toHaveTextContent('Backend'))
  })

  it('leaving the field saves too', async () => {
    const { user, onSave } = setup()
    await user.click(button())
    await user.type(field(), ' API')
    await user.tab()
    expect(onSave).toHaveBeenCalledWith('Backend API')
  })

  it('an unchanged value is not sent', async () => {
    const { user, onSave } = setup()
    await user.click(button())
    await user.keyboard('{Enter}')
    expect(onSave).not.toHaveBeenCalled()
    expect(button()).toBeInTheDocument()
  })

  it('a problem found on the page keeps the field open and says what is wrong', async () => {
    const { user, onSave } = setup({ validate: (v) => (v ? null : 'Enter a name.') })
    await user.click(button())
    await user.clear(field())
    await user.keyboard('{Enter}')
    expect(screen.getByText('Enter a name.')).toBeInTheDocument()
    expect(field()).toHaveAttribute('aria-invalid', 'true')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('shows the value through `format` and edits dates as dates', async () => {
    const { user } = setup({
      value: '2026-11-09', type: 'date', what: 'due date', format: (v) => `due ${v}`, inputProps: { min: '2026-11-02' },
    })
    await user.click(screen.getByRole('button', { name: 'due 2026-11-09, change due date' }))
    const input = screen.getByLabelText('Change due date')
    expect(input).toHaveAttribute('type', 'date')
    expect(input).toHaveAttribute('min', '2026-11-02')
  })
})
