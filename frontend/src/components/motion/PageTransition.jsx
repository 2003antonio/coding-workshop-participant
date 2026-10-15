import Box from '@mui/material/Box'
import { useLocation } from 'react-router-dom'
import { useMotion } from './motion'

/**
 * Fades the page in (150 ms, no movement) on every route change (a new path starts the animation
 * again). Used once, by AppShell, around the page content.
 */
export default function PageTransition({ children }) {
  const { pathname } = useLocation()
  const motion = useMotion()
  return <Box key={pathname} data-testid="page-transition" sx={motion('page')}>{children}</Box>
}
