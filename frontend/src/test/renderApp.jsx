// Test helper: render the whole app at a path, optionally at a phone width.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Context as ResponsiveContext } from 'react-responsive'
import { MemoryRouter } from 'react-router-dom'
import App from '../App'

export function renderApp(path, { width } = {}) {
  const app = (
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  )
  const user = userEvent.setup()
  const view = render(width ? <ResponsiveContext.Provider value={{ width }}>{app}</ResponsiveContext.Provider> : app)
  return { user, ...view }
}

/** Pick `option` in the MUI select labelled `label` (inside `container`, default the page). */
export async function choose(user, label, option, container = document.body) {
  await user.click(within(container).getByRole('combobox', { name: label }))
  await user.click(await screen.findByRole('option', { name: option }))
}

/** The text of every column header in the table labelled `name`. */
export const headersOf = (name) =>
  within(screen.getByRole('table', { name })).getAllByRole('columnheader').map((th) => th.textContent)

/** The <tr> whose row header matches `name`. */
export const rowFor = (name, container = document.body) =>
  within(container).getByRole('rowheader', { name: new RegExp(name) }).closest('tr')
