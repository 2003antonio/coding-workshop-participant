import { useState } from 'react'

/** Rows per page a list may offer; the first is the default for tables. */
export const PAGE_SIZES = [25, 50, 100]

/**
 * One page of `rows`, for lists the server sends whole (only the activity feed
 * pages on the server). The page goes back to the first one when the number of
 * rows changes (a filter, a search, an archive), and never points past the end.
 *   const pager = usePagination(rows, { pageSize: 12 })
 *   pager.rows        the rows of the current page
 *   pager.page        0-based page;  pager.setPage(n)
 *   pager.pageSize    rows per page; pager.setPageSize(n) (back to the first page)
 *   pager.count       all rows
 */
export function usePagination(rows, { pageSize: initialSize = PAGE_SIZES[0] } = {}) {
  const [page, setPage] = useState(0)
  const [pageSize, setSize] = useState(initialSize)
  const [seenCount, setSeenCount] = useState(rows.length)
  if (seenCount !== rows.length) {
    // Adjusting state while rendering (not in an effect) avoids one render with the old page.
    setSeenCount(rows.length)
    setPage(0)
  }
  const lastPage = Math.max(0, Math.ceil(rows.length / pageSize) - 1)
  const current = Math.min(page, lastPage)
  return {
    rows: rows.slice(current * pageSize, (current + 1) * pageSize),
    page: current,
    setPage,
    pageSize,
    setPageSize: (size) => {
      setSize(size)
      setPage(0)
    },
    count: rows.length,
  }
}
