import { createTheme } from '@mui/material/styles'

// One shared Material UI theme for the whole app.
const theme = createTheme({
  palette: {
    primary: { main: '#1f4e8c' },
  },
  shape: { borderRadius: 8 },
})

export default theme
