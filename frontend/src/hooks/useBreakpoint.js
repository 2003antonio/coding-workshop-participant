import { useMediaQuery } from 'react-responsive'

/**
 * Screen size, from react-responsive (tests set the width with renderApp's
 * { width } option):
 *   phone   < 600 px   (one column, cards instead of tables)
 *   tablet  600-899 px (sidebar becomes a drawer)
 *   desktop >= 900 px
 *   const { isPhone, isTablet, isDesktop } = useBreakpoint()
 */
export function useBreakpoint() {
  const isPhone = useMediaQuery({ maxWidth: 599 })
  const isTablet = useMediaQuery({ minWidth: 600, maxWidth: 899 })
  // Written as "neither" so a test with no width (jsdom) counts as desktop.
  return { isPhone, isTablet, isDesktop: !isPhone && !isTablet }
}
