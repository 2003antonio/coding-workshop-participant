import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Context as ResponsiveContext } from 'react-responsive'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Paginated from './Paginated'
import ResponsiveTable from './ResponsiveTable'

const items = (n) => Array.from({ length: n }, (_, i) => ({ id: `i-${i + 1}`, name: `Item ${i + 1}` }))

function List({ rows, ...props }) {
  return (
    <Paginated rows={rows} label="Items" {...props}>
      {(page) => <ul aria-label="Items">{page.map((r) => <li key={r.id}>{r.name}</li>)}</ul>}
    </Paginated>
  )
}
const shown = () => within(screen.getByRole('list', { name: 'Items' })).getAllByRole('listitem').map((li) => li.textContent)
const pages = () => screen.getByRole('navigation', { name: 'Items pages' })

afterEach(() => vi.restoreAllMocks())

describe('Paginated', () => {
  it('a list that fits on one page has no page controls', () => {
    render(<List rows={items(25)} />)
    expect(shown()).toHaveLength(25)
    expect(screen.queryByRole('navigation', { name: 'Items pages' })).not.toBeInTheDocument()
  })

  it('pages through a long list with first, previous, next and last', async () => {
    const user = userEvent.setup()
    render(<List rows={items(60)} />)
    expect(shown()).toHaveLength(25)
    expect(shown()[0]).toBe('Item 1')
    expect(pages()).toHaveTextContent('1–25 of 60')
    expect(within(pages()).getByRole('button', { name: 'Go to previous page' })).toBeDisabled()

    await user.click(within(pages()).getByRole('button', { name: 'Go to next page' }))
    expect(shown()[0]).toBe('Item 26')
    expect(pages()).toHaveTextContent('26–50 of 60')

    await user.click(within(pages()).getByRole('button', { name: 'Go to last page' }))
    expect(shown()).toEqual(['Item 51', 'Item 52', 'Item 53', 'Item 54', 'Item 55', 'Item 56', 'Item 57',
      'Item 58', 'Item 59', 'Item 60'])
    expect(within(pages()).getByRole('button', { name: 'Go to next page' })).toBeDisabled()

    await user.click(within(pages()).getByRole('button', { name: 'Go to first page' }))
    expect(shown()[0]).toBe('Item 1')
  })

  it('rows per page can change, which starts again at the first page', async () => {
    const user = userEvent.setup()
    render(<List rows={items(60)} />)
    await user.click(within(pages()).getByRole('button', { name: 'Go to next page' }))
    await user.click(within(pages()).getByRole('combobox', { name: /rows per page/i }))
    await user.click(screen.getByRole('option', { name: '50' }))
    expect(shown()).toHaveLength(50)
    expect(shown()[0]).toBe('Item 1')
  })

  it('uses the page size and choices it is given', () => {
    render(<List rows={items(20)} pageSize={12} pageSizes={[12, 24, 48]} />)
    expect(shown()).toHaveLength(12)
    expect(pages()).toHaveTextContent('1–12 of 20')
  })

  it('on a phone: page buttons, no rows-per-page choice', () => {
    render(<ResponsiveContext.Provider value={{ width: 390 }}><List rows={items(60)} /></ResponsiveContext.Provider>)
    expect(within(pages()).getByRole('button', { name: 'Go to next page' })).toBeInTheDocument()
    expect(within(pages()).queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('turning the page brings the list back into view when its top has scrolled away', async () => {
    const user = userEvent.setup()
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    render(<List rows={items(60)} />)
    const box = screen.getByRole('list', { name: 'Items' }).parentElement
    vi.spyOn(box, 'getBoundingClientRect').mockReturnValue({ top: 0 })
    await user.click(within(pages()).getByRole('button', { name: 'Go to next page' }))
    expect(scroll).not.toHaveBeenCalled() // already in view

    box.getBoundingClientRect.mockReturnValue({ top: -800 })
    await user.click(within(pages()).getByRole('button', { name: 'Go to next page' }))
    expect(scroll).toHaveBeenCalledWith({ block: 'start' })
    delete Element.prototype.scrollIntoView
  })
})

describe('ResponsiveTable pages long lists', () => {
  const columns = [{ key: 'name', label: 'Name', render: (r) => r.name }]

  it('as a table on a wide screen', async () => {
    const user = userEvent.setup()
    render(<ResponsiveTable label="Things" columns={columns} rows={items(30)} empty="None" />)
    const table = screen.getByRole('table', { name: 'Things' })
    expect(within(table).getAllByRole('row')).toHaveLength(26) // header + 25
    const nav = screen.getByRole('navigation', { name: 'Things pages' })
    await user.click(within(nav).getByRole('button', { name: 'Go to next page' }))
    expect(within(table).getAllByRole('rowheader').map((c) => c.textContent)).toEqual(
      ['Item 26', 'Item 27', 'Item 28', 'Item 29', 'Item 30'])
  })

  it('as cards on a phone', () => {
    render(
      <ResponsiveContext.Provider value={{ width: 390 }}>
        <ResponsiveTable label="Things" columns={columns} rows={items(30)} empty="None" pageSize={10} />
      </ResponsiveContext.Provider>,
    )
    expect(within(screen.getByRole('list', { name: 'Things' })).getAllByRole('listitem')).toHaveLength(10)
    expect(screen.getByRole('navigation', { name: 'Things pages' })).toHaveTextContent('1–10 of 30')
  })

  it('a short list is unchanged, and an empty one still says so', () => {
    const { rerender } = render(<ResponsiveTable label="Things" columns={columns} rows={items(3)} empty="None" />)
    expect(within(screen.getByRole('table', { name: 'Things' })).getAllByRole('row')).toHaveLength(4)
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    rerender(<ResponsiveTable label="Things" columns={columns} rows={[]} empty="None" />)
    expect(screen.getByText('None')).toBeInTheDocument()
  })
})
