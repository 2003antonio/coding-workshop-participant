import Box from '@mui/material/Box'

/** The one content width: every page has the same left edge and the same maximum width. */
export const PAGE_MAX_WIDTH = 1200

/**
 * The <main> region of every signed-in page (AppShell renders it), and the
 * same box for the page skeleton, so nothing jumps when a page loads.
 */
export default function PageContainer({ children, component = 'main' }) {
  const isMain = component === 'main'
  return (
    <Box component={component} id={isMain ? 'main-content' : undefined} tabIndex={isMain ? -1 : undefined} sx={{
      width: '100%', maxWidth: PAGE_MAX_WIDTH, minWidth: 0, boxSizing: 'border-box',
      px: { xs: 2, sm: 3, md: 4 }, py: { xs: 3, md: 4 }, outline: 'none',
    }}>
      {children}
    </Box>
  )
}
