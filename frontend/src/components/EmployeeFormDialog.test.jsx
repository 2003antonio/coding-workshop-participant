import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { signedInAs } from '../test/fakeApiServer'
import { renderApp } from '../test/renderApp'
import { fullEmail, withSeparators } from './employeeFields'
import { PASSWORD_CLASSES, PASSWORD_LENGTH, generatePassword } from './tempPassword'

// The app makes a random password; here a stub hands out known ones in turn.
const stub = vi.hoisted(() => ({ n: 0 }))
vi.mock('./tempPassword', async (importOriginal) => ({
  ...(await importOriginal()),
  generatePassword: (random) => (random ? 'unused' : `Stub-Temp-Pass-${(stub.n += 1)}`),
}))

describe('employee form helpers', () => {
  it('adds thousands separators to the whole part only, and leaves text it cannot read', () => {
    expect(withSeparators('70000.5')).toBe('70,000.5')
    expect(withSeparators('1,234567')).toBe('1,234,567')
    expect(withSeparators('950')).toBe('950')
    expect(withSeparators('12abc')).toBe('12abc')
  })

  it('completes the part before the @ with the company domain, or keeps a full address', () => {
    expect(fullEmail(' nia ')).toBe('nia@acme-demo.test')
    expect(fullEmail('nia@elsewhere.test')).toBe('nia@elsewhere.test')
  })
})

describe('the real password generator', async () => {
  const { generatePassword: real } = await vi.importActual('./tempPassword')
  it('makes 16 characters with every class and no look-alikes', () => {
    expect(generatePassword).toBeTypeOf('function')
    for (let i = 0; i < 50; i += 1) {
      const password = real()
      expect(password).toHaveLength(PASSWORD_LENGTH)
      for (const chars of PASSWORD_CLASSES) expect([...password].some((c) => chars.includes(c))).toBe(true)
      expect(password).not.toMatch(/[0O1lIio]/)
    }
  })
})

describe('Add employee dialog', () => {
  async function openAdd() {
    const server = signedInAs('admin')
    const view = renderApp('/employees')
    await screen.findByRole('table', { name: 'Employees' })
    await view.user.click(screen.getByRole('button', { name: 'Add employee' }))
    return { server, user: view.user, dialog: await screen.findByRole('dialog', { name: 'Add employee' }) }
  }

  it('sends the typed name plus the domain, a $ salary without separators, and only a generated password', async () => {
    const { server, user, dialog } = await openAdd()
    const email = within(dialog).getByRole('textbox', { name: 'Email' })
    await user.type(within(dialog).getByRole('textbox', { name: /^name/i }), 'Nia New')
    await user.type(email, 'nia')
    expect(within(dialog).getByText('@acme-demo.test')).toBeInTheDocument()
    await user.type(within(dialog).getByRole('textbox', { name: /job title/i }), 'Analyst')
    const salary = within(dialog).getByRole('textbox', { name: 'Salary (yearly)' })
    expect(salary).toHaveAttribute('inputmode', 'decimal')
    expect(within(dialog).getByText('$')).toBeInTheDocument()
    await user.type(salary, '70000.5')
    await user.tab()
    expect(salary).toHaveValue('70,000.5')

    // Blocked until a password is generated.
    await user.click(within(dialog).getByRole('button', { name: 'Add employee' }))
    expect(within(dialog).getByText('Generate a temporary password first.')).toBeInTheDocument()
    expect(server.count('POST', '/api/employees/')).toBe(0)

    await user.click(within(dialog).getByRole('button', { name: 'Generate temporary password' }))
    const shown = within(dialog).getByRole('textbox', { name: 'Temporary password' })
    expect(shown).toHaveAttribute('readonly')
    expect(within(dialog).getByText('Share this with the person once; it will not be shown again.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Generate another' }))
    const password = shown.value
    expect(password).toMatch(/^Stub-Temp-Pass-\d+$/)

    // Copy: the toast never contains the password.
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await user.click(within(dialog).getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith(password)
    const toast = await screen.findByRole('status')
    expect(toast).toHaveTextContent('Password copied')
    expect(toast).not.toHaveTextContent(password)

    await user.click(within(dialog).getByRole('button', { name: 'Add employee' }))
    expect(await screen.findByText('Employee added: Nia New')).toBeInTheDocument()
    const post = server.calls.find((c) => c.method === 'POST' && c.path === '/api/employees/')
    expect(post.body).toMatchObject({ email: 'nia@acme-demo.test', salary: 70000.5, password })
    expect(document.body).not.toHaveTextContent(password) // gone with the dialog
  })

  it('a typed full address hides the domain and is sent as typed; a failed copy says what to do', async () => {
    const { user, dialog } = await openAdd()
    await user.type(within(dialog).getByRole('textbox', { name: 'Email' }), 'nia@partner.test')
    expect(within(dialog).queryByText('@acme-demo.test')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Generate temporary password' }))
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true,
    })
    await user.click(within(dialog).getByRole('button', { name: 'Copy' }))
    expect(await within(dialog).findByText(/Select the password and copy it by hand/)).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
