// "My work": the signed-in person's hours per week across all their projects
// (report 3, or their own allocations when report 3 does not list them) and
// their assignments. Used on /my-work and on an employee's Home.
// Admin allocation objects carry hourly_rate and weekly_cost: never shown here.
import { useCallback, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { Link as RouterLink } from 'react-router-dom'
import { useLoad } from '../../auth/useApi'
import { useAuth } from '../../auth/useAuth'
import { formatDate, formatWeek } from '../../pages/format'
import * as allocationService from '../../services/allocationService'
import * as reportService from '../../services/reportService'
import { shiftWeek } from '../heatmap/heatScale'
import { Empty, LoadState } from '../PageState'
import ResponsiveTable from '../ResponsiveTable'
import HoursChart from './HoursChart'
import { weeksFromAllocations } from './weekMath'

const WEEKS = 12 // report 3's default window

/** Report 3's row for `userId`, or the same weeks built from their own allocations. */
async function loadMyWeeks(call, userId, from) {
  const report = await call((token) => reportService.resourceAllocation(token, { from: from ?? undefined }))
  const mine = report.people.find((p) => p.id === userId)
  if (mine) return { weeks: mine.weeks }
  const own = await call((token) => allocationService.listAllocations(token, {
    employeeId: userId, from: report.weeks[0], to: report.weeks.at(-1),
  }))
  return { weeks: weeksFromAllocations(report.weeks, own) }
}

function HoursSection({ userId }) {
  const [from, setFrom] = useState(null) // null: the server's default window (this week + 11)
  const load = useCallback((call) => loadMyWeeks(call, userId, from), [userId, from])
  const result = useLoad(load)
  const first = result.data?.weeks?.[0]?.week_start
  const span = result.data?.weeks?.length || WEEKS
  return (
    <Paper component="section" variant="outlined" aria-labelledby="my-hours-heading" sx={{ p: 2, mb: 3 }}>
      <Typography id="my-hours-heading" variant="h6" component="h2" gutterBottom>Hours per week</Typography>
      <Box component="nav" aria-label="Weeks shown" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
        <Button size="small" variant="outlined" sx={{ minHeight: 44 }} disabled={!first}
          onClick={() => setFrom(shiftWeek(first, -span))}>
          Previous {span} weeks
        </Button>
        <Button size="small" variant="outlined" sx={{ minHeight: 44 }} disabled={!first}
          onClick={() => setFrom(shiftWeek(first, span))}>
          Next {span} weeks
        </Button>
        {from && <Button size="small" sx={{ minHeight: 44 }} onClick={() => setFrom(null)}>This week</Button>}
      </Box>
      <LoadState result={result} label="Loading your hours" skeleton="chart">
        {({ weeks }) => (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {weeks.length} weeks, from the {formatWeek(weeks[0]?.week_start)}.
            </Typography>
            {weeks.every((w) => w.total_hours === 0)
              ? <Empty>No hours booked in these weeks.</Empty>
              : <HoursChart weeks={weeks} />}
          </>
        )}
      </LoadState>
    </Paper>
  )
}

function AssignmentsSection({ userId }) {
  const load = useCallback(
    (call) => call((token) => allocationService.listAllocations(token, { employeeId: userId })),
    [userId],
  )
  const result = useLoad(load)
  return (
    <Box component="section" aria-labelledby="my-assignments-heading">
      <Typography id="my-assignments-heading" variant="h6" component="h2" gutterBottom>Assignments</Typography>
      <LoadState result={result} label="Loading your assignments" skeleton="table">
        {(rows) => (rows.length === 0 ? <Empty>Nothing assigned yet.</Empty> : (
          <ResponsiveTable label="Assignments" rows={rows} empty="Nothing assigned yet." columns={[
            { key: 'project', label: 'Project', primary: true, render: (a) => (
              <Link component={RouterLink} to={`/projects/${encodeURIComponent(a.project.id)}`}>{a.project.name}</Link>
            ) },
            { key: 'hours', label: 'Hours per week', align: 'right', render: (a) => `${a.hours_per_week} h` },
            { key: 'dates', label: 'Dates', render: (a) => `${formatDate(a.start_date)} – ${formatDate(a.end_date)}` },
          ]} />
        ))}
      </LoadState>
    </Box>
  )
}

export default function MyWorkView() {
  const { user } = useAuth()
  if (!user) return null
  return (
    <>
      <HoursSection userId={user.id} />
      <AssignmentsSection userId={user.id} />
    </>
  )
}
