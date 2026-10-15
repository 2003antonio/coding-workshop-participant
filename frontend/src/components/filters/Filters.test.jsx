import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FilterBar, SearchField, SelectFilter, SwitchFilter } from './Filters'

function Bar({ onClear }) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [only, setOnly] = useState(false)
  return (
    <>
      <FilterBar label="Filter things">
        <SearchField label="Search things" value={search} onChange={setSearch} onClear={onClear && (() => {
          onClear()
          setSearch('')
        })} />
        <SelectFilter label="Status" allLabel="All statuses" value={status} onChange={setStatus}
          options={[{ value: 'a', label: 'Active' }, { value: 'p', label: 'Planned' }]} />
        <SwitchFilter label="Only late" checked={only} onChange={setOnly} />
      </FilterBar>
      <output>{`${search}|${status}|${only}`}</output>
    </>
  )
}

describe('Filters', () => {
  it('a search region holding the controls, which report what was chosen', async () => {
    const user = userEvent.setup()
    render(<Bar />)
    const bar = screen.getByRole('search', { name: 'Filter things' })
    await user.type(within(bar).getByRole('searchbox', { name: 'Search things' }), 'abc')
    await user.click(within(bar).getByRole('combobox', { name: 'Status' }))
    await user.click(screen.getByRole('option', { name: 'Planned' }))
    await user.click(within(bar).getByRole('switch', { name: 'Only late' }))
    expect(screen.getByRole('status')).toHaveTextContent('abc|p|true')
  })

  it('"All ..." is the first choice and means no filter', async () => {
    const user = userEvent.setup()
    render(<Bar />)
    await user.click(screen.getByRole('combobox', { name: 'Status' }))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['All statuses', 'Active', 'Planned'])
    await user.click(screen.getByRole('option', { name: 'Active' }))
    await user.click(screen.getByRole('combobox', { name: 'Status' }))
    await user.click(screen.getByRole('option', { name: 'All statuses' }))
    expect(screen.getByRole('status')).toHaveTextContent('||false')
  })

  it('"Clear search" shows only with text, empties the box and puts the cursor back', async () => {
    const user = userEvent.setup()
    render(<Bar />)
    const box = screen.getByRole('searchbox', { name: 'Search things' })
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument()
    await user.type(box, 'abc')
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(box).toHaveValue('')
    expect(box).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument()
  })

  it('a page can take over clearing (e.g. to skip a search delay)', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    render(<Bar onClear={onClear} />)
    await user.type(screen.getByRole('searchbox', { name: 'Search things' }), 'x')
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(onClear).toHaveBeenCalledOnce()
    expect(screen.getByRole('searchbox', { name: 'Search things' })).toHaveValue('')
  })

  it('the search box stops at the server limit', () => {
    render(<Bar />)
    expect(screen.getByRole('searchbox', { name: 'Search things' })).toHaveAttribute('maxlength', '100')
  })
})
