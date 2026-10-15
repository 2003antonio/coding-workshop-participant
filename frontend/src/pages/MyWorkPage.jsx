import Typography from '@mui/material/Typography'
import AppShell from '../components/AppShell'
import MyWorkView from '../components/mywork/MyWorkView'
import { useBreakpoint } from '../hooks/useBreakpoint'

/** The signed-in person's own hours and assignments, for every role. */
export default function MyWorkPage() {
  const { isPhone } = useBreakpoint()
  return (
    <AppShell maxWidth="lg">
      <Typography variant={isPhone ? 'h5' : 'h4'} component="h1" gutterBottom>My work</Typography>
      <MyWorkView />
    </AppShell>
  )
}
