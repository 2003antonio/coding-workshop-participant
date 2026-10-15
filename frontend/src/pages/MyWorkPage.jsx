import AppShell from '../components/AppShell'
import MyWorkView from '../components/mywork/MyWorkView'
import PageHeader from '../components/PageHeader'

/** The signed-in person's own hours and assignments, for every role. */
export default function MyWorkPage() {
  return (
    <AppShell>
      <PageHeader title="My work" subtitle="Your hours per week across every project, and what you are assigned to." />
      <MyWorkView />
    </AppShell>
  )
}
