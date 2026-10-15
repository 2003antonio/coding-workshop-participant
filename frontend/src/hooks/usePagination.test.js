import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PAGE_SIZES, usePagination } from './usePagination'

const numbers = (n) => Array.from({ length: n }, (_, i) => i + 1)

describe('usePagination', () => {
  it('shows the first page of the default size, then any page', () => {
    const { result } = renderHook(() => usePagination(numbers(60)))
    expect(result.current.pageSize).toBe(PAGE_SIZES[0])
    expect(result.current.rows).toEqual(numbers(25))
    expect(result.current.count).toBe(60)

    act(() => result.current.setPage(2))
    expect(result.current.page).toBe(2)
    expect(result.current.rows).toEqual([51, 52, 53, 54, 55, 56, 57, 58, 59, 60])
  })

  it('a new page size starts again at the first page', () => {
    const { result } = renderHook(() => usePagination(numbers(60), { pageSize: 10 }))
    act(() => result.current.setPage(3))
    act(() => result.current.setPageSize(50))
    expect(result.current.page).toBe(0)
    expect(result.current.rows).toEqual(numbers(50))
  })

  it('goes back to the first page when the number of rows changes (a filter), not on a reload', () => {
    const { result, rerender } = renderHook(({ rows }) => usePagination(rows, { pageSize: 10 }),
      { initialProps: { rows: numbers(60) } })
    act(() => result.current.setPage(4))

    rerender({ rows: numbers(60).map((n) => n * 2) }) // same length: an edit or a reload
    expect(result.current.page).toBe(4)

    rerender({ rows: numbers(35) })
    expect(result.current.page).toBe(0)
    expect(result.current.rows).toEqual(numbers(10))
  })

  it('never points past the last page, and an empty list is one empty page', () => {
    const { result } = renderHook(() => usePagination(numbers(30), { pageSize: 10 }))
    act(() => result.current.setPage(9))
    expect(result.current.page).toBe(2)
    expect(result.current.rows).toEqual([21, 22, 23, 24, 25, 26, 27, 28, 29, 30])

    const empty = renderHook(() => usePagination([]))
    expect(empty.result.current.page).toBe(0)
    expect(empty.result.current.rows).toEqual([])
  })
})
