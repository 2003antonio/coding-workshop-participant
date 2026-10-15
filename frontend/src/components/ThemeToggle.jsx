import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined'
import LightModeOutlined from '@mui/icons-material/LightModeOutlined'
import IconButton from '@mui/material/IconButton'
import { useColorScheme } from '@mui/material/styles'

/** Light/dark switch. Starts from the computer's setting; MUI remembers a choice. */
export default function ThemeToggle({ sx }) {
  const { mode, systemMode, setMode } = useColorScheme()
  const isDark = (mode === 'system' ? systemMode : mode) === 'dark'
  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme'
  return (
    <IconButton aria-label={label} title={label} onClick={() => setMode(isDark ? 'light' : 'dark')}
      sx={[{ width: 44, height: 44, flexShrink: 0 }, sx]}>
      {isDark ? <LightModeOutlined /> : <DarkModeOutlined />}
    </IconButton>
  )
}
