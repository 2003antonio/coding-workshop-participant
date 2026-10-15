import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { reply, signedInAs } from '../../test/fakeApiServer'
import { headersOf, renderApp } from '../../test/renderApp'
import CapacityHeatmap, { HeatLegend } from './CapacityHeatmap'

const WEEKS = ['2026-11-09', '2026-11-16']
const week = (week_start, total_hours, projects = [], other_hours = 0) => ({ week_start, total_hours, projects, other_hours })
const PEOPLE = [
  { id: 'u-1', name: 'Ana Silva', team_id: 't', weeks: [
    week('2026-11-09', 36, [{ id: 'p', name: 'Billing v2', hours: 20 }], 16),
    week('2026-11-16', 0),
  ] },
  { id: 'u-2', name: 'Bo Builder', team_id: 't', weeks: [week('2026-11-09', 12), week('2026-11-16', 40)] },
]

describe('CapacityHeatmap', () => {
  it('each cell shows its number, a colour band, and a full name with person, week and year', () => {
    render(<CapacityHeatmap weeks={WEEKS} people={PEOPLE} />)
    const table = screen.getByRole('table', { name: 'Resource allocation' })
    const cell = within(table).getByRole('cell', { name: 'Ana Silva, week of Nov 9, 2026: 36 hours' })
    expect(cell).toHaveTextContent('36 h')
    expect(cell).toHaveAttribute('data-level', 'high')
    expect(within(table).getByRole('cell', { name: 'Ana Silva, week of Nov 16, 2026: 0 hours' }))
      .toHaveAttribute('data-level', 'empty')
    expect(within(table).getByRole('cell', { name: 'Bo Builder, week of Nov 9, 2026: 12 hours' }))
      .toHaveAttribute('data-level', 'low')
    expect(within(table).getByRole('cell', { name: 'Bo Builder, week of Nov 16, 2026: 40 hours' }))
      .toHaveAttribute('data-level', 'full')
  })

  it('is one Tab stop; arrow keys move between cells and focus shows the breakdown', async () => {
    const user = userEvent.setup()
    render(<CapacityHeatmap weeks={WEEKS} people={PEOPLE} />)
    const cells = screen.getAllByRole('cell')
    expect(cells.filter((c) => c.tabIndex === 0)).toHaveLength(1)

    await user.tab()
    expect(cells[0]).toHaveFocus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Billing v2: 20 hOther projects: 16 h')
    await user.keyboard('{ArrowRight}')
    expect(cells[1]).toHaveFocus()
    expect(cells[1]).toHaveAttribute('tabindex', '0')
    expect(cells[0]).toHaveAttribute('tabindex', '-1')
    await user.keyboard('{ArrowDown}')
    expect(cells[3]).toHaveFocus()
    await user.keyboard('{ArrowRight}{ArrowDown}') // stays inside the grid
    expect(cells[3]).toHaveFocus()
    await user.keyboard('{ArrowLeft}{ArrowUp}')
    expect(cells[0]).toHaveFocus()
    await user.keyboard('a') // other keys do nothing
    expect(cells[0]).toHaveFocus()
  })

  it('a week with no hours says so in its tooltip', async () => {
    const user = userEvent.setup()
    render(<CapacityHeatmap weeks={WEEKS} people={PEOPLE} />)
    await user.hover(screen.getByRole('cell', { name: /Ana Silva, week of Nov 16/ }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('No hours this week')
  })

  it('a missing week counts as 0', () => {
    render(<CapacityHeatmap weeks={[...WEEKS, '2026-11-23']} people={PEOPLE} />)
    expect(screen.getByRole('cell', { name: 'Bo Builder, week of Nov 23, 2026: 0 hours' })).toHaveTextContent('0 h')
  })

  it('the legend gives every band in words', () => {
    render(<HeatLegend />)
    expect(within(screen.getByRole('list', { name: 'Legend' })).getAllByRole('listitem').map((li) => li.textContent))
      .toEqual(['0 h', '1–16 h', '17–32 h', '33–39 h, near capacity', '40 h or more, full'])
  })

  it('on a phone the name column stays put while the weeks scroll', () => {
    render(<CapacityHeatmap weeks={WEEKS} people={PEOPLE} isPhone />)
    const name = screen.getByRole('rowheader', { name: 'Ana Silva' })
    expect(name).toHaveStyle({ position: 'sticky', left: '0px', maxWidth: '112px' })
    expect(screen.getByRole('columnheader', { name: 'Person' })).toHaveStyle({ position: 'sticky' })
  })
})

describe('Reports -> Resources', () => {
  it('pages through the weeks with the year shown, and back to this week', async () => {
    const server = signedInAs('manager')
    const { user } = renderApp('/reports?report=resources')
    await screen.findByRole('table', { name: 'Resource allocation' })
    expect(headersOf('Resource allocation')[1]).toBe('Nov 9 ’26')

    await user.click(screen.getByRole('button', { name: 'Next 12 weeks' }))
    await waitFor(() => expect(headersOf('Resource allocation')[1]).toBe('Feb 1 ’27'))
    expect(server.calls.filter((c) => c.path === '/api/reports/resource-allocation').at(-1).query).toBe('?from=2027-02-01')

    await user.click(screen.getByRole('button', { name: 'Previous 12 weeks' }))
    await waitFor(() => expect(headersOf('Resource allocation')[1]).toBe('Nov 9 ’26'))
    await user.click(screen.getByRole('button', { name: 'Previous 12 weeks' }))
    await waitFor(() => expect(headersOf('Resource allocation')[1]).toBe('Aug 17 ’26'))

    await user.click(screen.getByRole('button', { name: 'This week' }))
    await waitFor(() => expect(headersOf('Resource allocation')[1]).toBe('Nov 9 ’26'))
    expect(server.calls.filter((c) => c.path === '/api/reports/resource-allocation').at(-1).query).toBe('')
    expect(screen.queryByRole('button', { name: 'This week' })).not.toBeInTheDocument()
  })

  it('shows the legend, and no money anywhere, even for an admin', async () => {
    signedInAs('admin')
    renderApp('/reports?report=resources')
    const table = await screen.findByRole('table', { name: 'Resource allocation' })
    expect(screen.getByRole('list', { name: 'Legend' })).toBeInTheDocument()
    expect(table.textContent).not.toMatch(/\d,\d{3}|\.\d{2}|salary|rate|cost/i)
  })

  it('says so when there is no one to show', async () => {
    signedInAs('admin', { routes: { 'GET /api/reports/resource-allocation': () => reply(200, { weeks: ['2026-11-09'], people: [] }) } })
    renderApp('/reports?report=resources')
    expect(await screen.findByText('No one to show.')).toBeInTheDocument()
  })

  it('works at phone width as a scrolling table', async () => {
    signedInAs('manager')
    renderApp('/reports?report=resources', { width: 390 })
    const table = await screen.findByRole('table', { name: 'Resource allocation' })
    expect(within(table).getByRole('rowheader', { name: 'Eve Employee' })).toHaveStyle({ position: 'sticky' })
  })
})
