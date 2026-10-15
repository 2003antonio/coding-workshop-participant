import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { signedInAs } from '../test/fakeApiServer'
import { renderApp } from '../test/renderApp'

describe('Breadcrumbs', () => {
  it('Project detail: "Projects > <name>" in a Breadcrumb nav; the last crumb is the current page', async () => {
    signedInAs('manager')
    renderApp('/projects/p-1')
    await screen.findByRole('heading', { level: 1, name: 'Billing v2' })
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(nav).getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/projects')
    const current = within(nav).getByText('Billing v2')
    expect(current).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getAllByRole('link')).toHaveLength(1)
    expect(screen.getByRole('navigation', { name: 'Main' })).not.toBe(nav)
  })

  it('Team detail on a phone shows only the parent, as a back link', async () => {
    signedInAs('admin')
    renderApp('/teams/t-1', { width: 390 })
    await screen.findByRole('heading', { level: 1, name: 'Platform' })
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(nav).getByRole('link', { name: 'Teams' })).toHaveAttribute('href', '/teams')
    expect(within(nav).queryByText('Platform')).not.toBeInTheDocument()
  })
})
