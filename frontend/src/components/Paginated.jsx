import { useRef } from 'react'
import Box from '@mui/material/Box'
import TablePagination from '@mui/material/TablePagination'
import { PAGE_SIZES, usePagination } from '../hooks/usePagination'
import { useBreakpoint } from '../hooks/useBreakpoint'

const BUTTON_SX = { width: 44, height: 44 }

/**
 * Shows a long list one page at a time, with the page controls under it.
 *   <Paginated rows={rows} label="Teams" pageSize={12} pageSizes={[12, 24, 48]}>
 *     {(pageRows) => <TeamCards rows={pageRows} />}
 *   </Paginated>
 * A list that fits on one page looks exactly as before: no controls. The controls
 * are a nav named "<label> pages" ("1–25 of 511", first/previous/next/last, and
 * rows per page except on a phone). Turning the page brings the list's top into view.
 */
export default function Paginated({ rows, label, pageSize = PAGE_SIZES[0], pageSizes = PAGE_SIZES, children }) {
  const pager = usePagination(rows, { pageSize })
  const { isPhone } = useBreakpoint()
  const top = useRef(null)
  const needed = pager.count > Math.min(pager.pageSize, ...pageSizes)

  function turnTo(page) {
    pager.setPage(page)
    const box = top.current
    if (box && box.getBoundingClientRect().top < 0) box.scrollIntoView?.({ block: 'start' })
  }

  return (
    <Box ref={top} sx={{ scrollMarginTop: 80 }}>
      {children(pager.rows)}
      {needed && (
        <TablePagination component="nav" aria-label={`${label} pages`}
          count={pager.count} page={pager.page} rowsPerPage={pager.pageSize}
          rowsPerPageOptions={isPhone ? [] : pageSizes}
          onPageChange={(_, page) => turnTo(page)}
          onRowsPerPageChange={(e) => pager.setPageSize(Number(e.target.value))}
          showFirstButton showLastButton
          slotProps={{
            actions: {
              firstButton: { sx: BUTTON_SX }, previousButton: { sx: BUTTON_SX },
              nextButton: { sx: BUTTON_SX }, lastButton: { sx: BUTTON_SX },
            },
          }}
          sx={{
            borderBottom: 0, overflow: 'visible',
            '& .MuiTablePagination-toolbar': { flexWrap: 'wrap', justifyContent: 'flex-end', px: 0 },
            '& .MuiTablePagination-input': { minHeight: 44 },
          }} />
      )}
    </Box>
  )
}
