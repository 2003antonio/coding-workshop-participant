import { createTheme } from '@mui/material/styles'

// One shared Material UI theme for the whole app, in a light and a dark scheme.
// MUI turns every palette value into a CSS variable, so components read
// theme.vars.palette.* and switch scheme without re-rendering.
// The mode starts from the computer's setting; the toggle in AppShell stores
// the choice (MUI keeps it in localStorage and already wraps that in try/catch).

/**
 * Status colours, defined once per mode as text (fg) on background (bg).
 * StatusChip and BudgetFlag use them; theme.test.js checks every pair reaches
 * a 4.5:1 contrast ratio. To add a status, add it to BOTH modes.
 */
export const STATUS_COLORS = {
  light: {
    done: { fg: '#1B6B34', bg: '#E5F4EA' },
    in_progress: { fg: '#1F4E8C', bg: '#E3EDF8' },
    not_started: { fg: '#4A5566', bg: '#EDF0F4' },
    overdue: { fg: '#A3191B', bg: '#FCE9E9' },
    blocked: { fg: '#8A4600', bg: '#FFF1DB' },
    over_budget: { fg: '#FFFFFF', bg: '#B42318' },
  },
  dark: {
    done: { fg: '#8FE0A8', bg: '#173A25' },
    in_progress: { fg: '#A8C8F5', bg: '#172F4E' },
    not_started: { fg: '#C9D1DC', bg: '#2A3445' },
    overdue: { fg: '#FFB4AB', bg: '#4A1C1C' },
    blocked: { fg: '#FFD48A', bg: '#45320F' },
    over_budget: { fg: '#4A0B0B', bg: '#FFB4AB' },
  },
}

/**
 * Avatar and project-tile colours: text (fg) on background (bg) per mode, picked
 * by a hash of the name (components/viz/vizMath.js). No red or amber, so a
 * person's colour never reads as a status. theme.test.js checks 4.5:1 for each.
 */
export const AVATAR_COLORS = {
  light: [
    { fg: '#FFFFFF', bg: '#1F4E8C' },
    { fg: '#FFFFFF', bg: '#0B6E78' },
    { fg: '#FFFFFF', bg: '#6B3FA0' },
    { fg: '#FFFFFF', bg: '#1B6B34' },
    { fg: '#FFFFFF', bg: '#4A4FA8' },
    { fg: '#FFFFFF', bg: '#8E2F6E' },
    { fg: '#FFFFFF', bg: '#3D5266' },
    { fg: '#FFFFFF', bg: '#0A5A8A' },
  ],
  dark: [
    { fg: '#0A2540', bg: '#A8C8F5' },
    { fg: '#0A2540', bg: '#8FDCE3' },
    { fg: '#0A2540', bg: '#D3B8F0' },
    { fg: '#0A2540', bg: '#9FE3B4' },
    { fg: '#0A2540', bg: '#BFC3F7' },
    { fg: '#0A2540', bg: '#F2B8DD' },
    { fg: '#0A2540', bg: '#C9D1DC' },
    { fg: '#0A2540', bg: '#9DD3F5' },
  ],
}

/**
 * sx for a chip in a status colour: <Chip sx={toneSx('done')} label="Done" />.
 * The label always says the status too, so colour is never the only signal.
 */
export const toneSx = (tone) => (theme) => {
  const colors = (theme.vars ?? theme).palette.status?.[tone]
  return colors ? { color: colors.fg, bgcolor: colors.bg } : {}
}

/**
 * The one card style: radius, border and shadow for every card (Paper), and a
 * gentle lift for cards that are links. The lift is a transform, so nothing
 * around the card moves, and it is switched off under "reduce motion".
 */
export const CARD = {
  radius: 12,
  shadow: '0 1px 2px rgba(10, 37, 64, 0.06), 0 1px 3px rgba(10, 37, 64, 0.08)',
  hoverShadow: '0 6px 16px rgba(10, 37, 64, 0.12), 0 2px 4px rgba(10, 37, 64, 0.08)',
}

/** sx for a clickable card: lifts 2 px on hover, settles when pressed. */
export const clickableCardSx = {
  transition: 'transform 150ms ease-out, box-shadow 150ms ease-out, border-color 150ms ease-out',
  '&:hover': { transform: 'translateY(-2px)', boxShadow: CARD.hoverShadow, borderColor: 'primary.main' },
  '&:active': { transform: 'translateY(0)', boxShadow: CARD.shadow },
  '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover, &:active': { transform: 'none' } },
}

/** A muted (archived) row: a faint background and secondary text; links and buttons keep their colour. */
export const MUTED_ROW_SX = { bgcolor: 'action.hover', '& td, & th, & dd, & dt, & h3': { color: 'text.secondary' } }

/** Brand colours from the design brief. */
export const BRAND = { navy: '#0A2540', blue: '#1F4E8C', teal: '#0B7A86' }

/** Relative luminance of a "#rrggbb" colour (WCAG 2.x). */
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two "#rrggbb" colours, from 1 to 21. */
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const light = {
  primary: { main: BRAND.blue, contrastText: '#FFFFFF' },
  secondary: { main: BRAND.teal, contrastText: '#FFFFFF' },
  error: { main: '#B42318', contrastText: '#FFFFFF' },
  warning: { main: '#9A5200', contrastText: '#FFFFFF' },
  success: { main: '#1B7A3A', contrastText: '#FFFFFF' },
  info: { main: BRAND.blue, contrastText: '#FFFFFF' },
  background: { default: '#F4F6F9', paper: '#FFFFFF' },
  text: { primary: '#132B45', secondary: '#4A5566' },
  divider: '#DDE3EA',
  sidebar: { bg: BRAND.navy, fg: '#D6E1EE', active: 'rgba(255, 255, 255, 0.12)', accent: '#5CC8D3', edge: BRAND.navy },
  status: STATUS_COLORS.light,
}

const dark = {
  primary: { main: '#8AB8F2', contrastText: BRAND.navy },
  secondary: { main: '#5CC8D3', contrastText: BRAND.navy },
  error: { main: '#FF9B91', contrastText: '#3A0909' },
  warning: { main: '#FFC861', contrastText: '#2E1E00' },
  success: { main: '#7FD69A', contrastText: '#0B2E17' },
  info: { main: '#8AB8F2', contrastText: BRAND.navy },
  background: { default: '#0B1624', paper: '#13233A' },
  text: { primary: '#E6EDF5', secondary: '#A9B6C6' },
  divider: '#24364F',
  sidebar: { bg: '#03101F', fg: '#C9D6E5', active: 'rgba(255, 255, 255, 0.10)', accent: '#5CC8D3', edge: '#2B4566' },
  status: STATUS_COLORS.dark,
}

const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'data' },
  colorSchemes: { light: { palette: light }, dark: { palette: dark } },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
    h4: { fontWeight: 700, letterSpacing: '-0.01em' },
    h5: { fontWeight: 700 },
    h6: { fontWeight: 600 },
    button: { fontWeight: 600, textTransform: 'none' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        // Digits all the same width, so money, hours and percentages line up in columns and do not jiggle on update.
        body: { fontVariantNumeric: 'tabular-nums' },
        // One visible focus ring for everything reached by keyboard.
        'a:focus-visible, button:focus-visible, [role="tab"]:focus-visible, [role="button"]:focus-visible': {
          outline: '2px solid var(--mui-palette-primary-main)', outlineOffset: 2,
        },
        // Respect "reduce motion": no shimmer, no sliding drawers.
        '@media (prefers-reduced-motion: reduce)': {
          '*, *::before, *::after': {
            animationDuration: '0.01ms !important',
            animationIterationCount: '1 !important',
            transitionDuration: '0.01ms !important',
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        rounded: { borderRadius: CARD.radius },
        outlined: { borderColor: 'var(--mui-palette-divider)' },
        elevation1: { boxShadow: CARD.shadow },
      },
    },
    MuiButton: { defaultProps: { disableElevation: true } },
    // Links look the same everywhere: brand colour, a little bolder, underline kept (colour is not the only signal).
    MuiLink: {
      styleOverrides: {
        root: {
          fontWeight: 600, textUnderlineOffset: '3px', textDecorationThickness: '1px',
          '&:hover': { textDecorationThickness: '2px' },
        },
      },
    },
    MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
    MuiLinearProgress: {
      defaultProps: { color: 'secondary' },
      styleOverrides: { root: { borderRadius: 4, height: 8 } },
    },
  },
})

export default theme
