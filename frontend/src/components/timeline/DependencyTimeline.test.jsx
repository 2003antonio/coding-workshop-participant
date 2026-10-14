import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import DependencyTimeline from './DependencyTimeline'

// Billing v2 as report 6 returns it: API spec -> Backend -> Frontend.
const CHAIN = {
  project_id: 'p-1',
  nodes: [
    { id: 'd-1', name: 'API spec', status: 'done', start_date: '2026-11-02', due_date: '2026-11-06', depth: 0 },
    { id: 'd-2', name: 'Backend', status: 'in_progress', start_date: '2026-11-09', due_date: '2026-12-04', depth: 1 },
    { id: 'd-3', name: 'Frontend', status: 'not_started', start_date: '2026-11-02', due_date: '2026-11-09', depth: 2 },
  ],
  edges: [{ from: 'd-1', to: 'd-2' }, { from: 'd-2', to: 'd-3' }],
  order: ['d-1', 'd-2', 'd-3'],
  longest_chain: ['d-1', 'd-2', 'd-3'],
}
const TODAY = '2026-11-10'

describe('DependencyTimeline on a wide screen', () => {
  it('draws one bar per deliverable in the server order, placed by date', () => {
    render(<DependencyTimeline chain={CHAIN} today={TODAY} />)
    const chart = screen.getByRole('group', { name: 'Dependency timeline' })
    const bars = within(chart).getAllByRole('img')
    expect(bars.map((b) => b.dataset.bar)).toEqual(['d-1', 'd-2', 'd-3'])
    // The span is Nov 2 to Dec 4 (33 days): Backend starts on day 7.
    expect(parseFloat(bars[1].style.left)).toBeCloseTo((7 / 33) * 100)
    expect(bars[0].style.left).toBe('0%')
    expect(bars.map((b) => b.style.top)).toEqual(['10px', '54px', '98px'])
    expect(within(chart).getByText('Nov 2, 2026 – Dec 4, 2026')).toBeInTheDocument()
    expect(within(chart).getByText('Nov 9, 2026')).toBeInTheDocument() // an axis tick, with the year
  })

  it('marks overdue and blocked in words, not only colour', () => {
    render(<DependencyTimeline chain={CHAIN} today={TODAY} />)
    const chart = screen.getByRole('group', { name: 'Dependency timeline' })
    expect(within(chart).getAllByText('Overdue')).toHaveLength(1)
    expect(within(chart).getAllByText('Blocked')).toHaveLength(1)
    expect(within(chart).getByRole('img', { name: /^Frontend: not started, overdue, blocked,/ })).toBeInTheDocument()
    expect(within(chart).getByRole('img', { name: /^API spec: done, starts/ })).toBeInTheDocument()
  })

  it('draws a line from each dependency’s end to the dependent’s start; the chain lines are thicker', () => {
    const { container } = render(<DependencyTimeline chain={{ ...CHAIN, longest_chain: ['d-1', 'd-2'] }} today={TODAY} />)
    const first = container.querySelector('[data-edge="d-1>d-2"]')
    const second = container.querySelector('[data-edge="d-2>d-3"]')
    const [x1, y1] = first.getAttribute('d').split(' ').slice(1, 3).map(Number)
    expect(x1).toBeCloseTo((5 / 33) * 100) // end of API spec
    expect(y1).toBe(22) // middle of the first row
    expect(first.getAttribute('d').endsWith(`H ${(7 / 33) * 100}`)).toBe(true) // start of Backend
    expect(first.getAttribute('stroke-width')).toBe('2.5')
    expect(second.getAttribute('stroke-width')).toBe('1.5')
  })

  it('keeps the "Longest chain:" sentence and a hidden ordered list that says it all in words', () => {
    render(<DependencyTimeline chain={CHAIN} today={TODAY} />)
    expect(screen.getByText('Longest chain:').parentElement).toHaveTextContent(
      'Longest chain: API spec → Backend → Frontend')
    const list = screen.getByRole('list', { name: 'Deliverables in dependency order' })
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'API spec: done, starts Nov 2, 2026, due Nov 6, 2026, on the longest chain.',
      'Backend: in progress, starts Nov 9, 2026, due Dec 4, 2026, waits for API spec, on the longest chain.',
      'Frontend: not started, overdue, blocked, starts Nov 2, 2026, due Nov 9, 2026, waits for Backend, on the longest chain.',
    ])
    expect(screen.getByRole('list', { name: 'Legend' })).toHaveTextContent('Blocked (striped)')
  })

  it('shows name, dates and status when a bar gets keyboard focus', async () => {
    const user = userEvent.setup()
    render(<DependencyTimeline chain={CHAIN} today={TODAY} />)
    await user.tab()
    expect(screen.getByRole('img', { name: /^API spec/ })).toHaveFocus()
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent('API spec')
    expect(tip).toHaveTextContent('Nov 2, 2026 – Nov 6, 2026')
    expect(tip).toHaveTextContent('Done')
  })

  it('shows a today line only when today is inside the chart', () => {
    const { rerender } = render(<DependencyTimeline chain={CHAIN} today={TODAY} />)
    expect(screen.getByTestId('today-line')).toBeInTheDocument()
    rerender(<DependencyTimeline chain={CHAIN} today="2027-06-01" />)
    expect(screen.queryByTestId('today-line')).not.toBeInTheDocument()
  })

  it('ignores ids in the order that are not among the nodes', () => {
    render(<DependencyTimeline chain={{ ...CHAIN, order: ['d-1', 'gone', 'd-2', 'd-3'] }} today={TODAY} />)
    expect(screen.getAllByRole('img')).toHaveLength(3)
  })
})

describe('DependencyTimeline on a phone', () => {
  it('has no chart: an ordered list with status chips, dates and what each waits for', () => {
    render(<DependencyTimeline chain={CHAIN} today={TODAY} isPhone />)
    expect(screen.queryByRole('group', { name: 'Dependency timeline' })).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    const items = within(screen.getByRole('list', { name: 'Deliverables in dependency order' })).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(within(items[0]).getByText('Done')).toBeInTheDocument()
    expect(within(items[0]).queryByText(/Waits for/)).not.toBeInTheDocument()
    expect(within(items[2]).getByRole('heading', { name: '3. Frontend' })).toBeInTheDocument()
    expect(within(items[2]).getByText('Nov 2, 2026 – Nov 9, 2026')).toBeInTheDocument()
    expect(within(items[2]).getByText('Waits for Backend')).toBeInTheDocument()
    expect(within(items[2]).getByText('Overdue')).toBeInTheDocument()
    expect(within(items[2]).getByText('Blocked')).toBeInTheDocument()
    expect(within(items[2]).getByText('Longest chain')).toBeInTheDocument()
    expect(screen.getByText('Longest chain:')).toBeInTheDocument()
  })
})
