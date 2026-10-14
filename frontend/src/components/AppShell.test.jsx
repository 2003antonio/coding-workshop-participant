import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { signedInAs } from '../test/fakeApiServer'
import { renderApp } from '../test/renderApp'
import { sectionTitle } from '../navigation'

describe('AppShell', () => {
  it('shows the sidebar links for the role, marks the current one, and names who is signed in', async () => {
    signedInAs('employee')
    renderApp('/projects')
    await screen.findByRole('heading', { level: 1, name: 'Projects' })
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Home', 'Projects', 'Teams', 'Reports'])
    expect(within(nav).getByRole('link', { name: 'Projects' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
    // The top bar title is plain text: the page keeps the only h1.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('banner')).toHaveTextContent('Projects')
    expect(within(screen.getByRole('banner')).getByText('Employee')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Menu' })).not.toBeInTheDocument()
  })

  it('has a "Skip to content" link to the main region', async () => {
    signedInAs('manager')
    renderApp('/')
    await screen.findByRole('heading', { name: /welcome/i })
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main-content')
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content')
  })

  it('switches between light and dark and remembers the choice', async () => {
    signedInAs('admin')
    const { user, unmount } = renderApp('/')
    await screen.findByRole('heading', { name: /welcome/i })
    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }))
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument()
    unmount()

    renderApp('/')
    await screen.findByRole('heading', { name: /welcome/i })
    const toggle = screen.getByRole('button', { name: 'Switch to light theme' })
    await user.click(toggle)
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument()
  })

  it('on a tablet the sidebar is a drawer behind "Menu", and the name moves out of the way on a phone', async () => {
    signedInAs('admin')
    const { user } = renderApp('/teams', { width: 700 })
    await screen.findByRole('heading', { level: 1, name: 'Teams' })
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
    const menu = screen.getByRole('button', { name: 'Menu' })
    expect(menu).toHaveAttribute('aria-expanded', 'false')
    await user.click(menu)
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Teams' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Employees' })).toBeInTheDocument()
  })

  it('hides the user name on a phone but keeps "Sign out"', async () => {
    signedInAs('admin')
    renderApp('/', { width: 390 })
    await screen.findByRole('heading', { name: /welcome/i })
    expect(within(screen.getByRole('banner')).queryByText('Ada Admin')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })
})

describe('sectionTitle', () => {
  it('names the section for a path, including detail pages', () => {
    expect(sectionTitle('/')).toBe('Home')
    expect(sectionTitle('/projects/p-1')).toBe('Projects')
    expect(sectionTitle('/teams')).toBe('Teams')
    expect(sectionTitle('/nowhere')).toBe('')
  })
})
