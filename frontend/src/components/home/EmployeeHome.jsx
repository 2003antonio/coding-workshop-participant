// An employee's Home: one line about the coming weeks and up to four cards that
// lead somewhere (My work, a project). The chart itself lives on My work only.
// Data: their own allocations (§6) and the deliverable report (§8, own projects).
import { useCallback } from 'react'
import EventOutlined from '@mui/icons-material/EventOutlined'
import FolderOutlined from '@mui/icons-material/FolderOutlined'
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined'
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined'
import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { Link as RouterLink } from 'react-router-dom'
import { useLoad } from '../../auth/useApi'
import { formatDate } from '../../pages/format'
import * as allocationService from '../../services/allocationService'
import * as reportService from '../../services/reportService'
import EmptyState from '../EmptyState'
import { LoadState } from '../PageState'
import { MAX_HOURS, weeksFromAllocations } from '../mywork/weekMath'
import ProjectTile from '../viz/ProjectTile'
import Sparkline from '../viz/Sparkline'
import {
  dueText, hoursThisWeek, localToday, myProjects, nextDeadline, overdueOrSoon, weeksFrom, workloadSummary,
} from './homeMath'

const projectPath = (id) => `/projects/${encodeURIComponent(id)}`

/** How many weeks ahead the sparkline beside the summary looks. */
const SPARK_WEEKS = 8

/** A titled card; with `to`, the whole card is one link (named by its title) with a focus ring. */
function HomeCard({ id, title, icon: Icon, to, children }) {
  const headingId = `${id}-heading`
  return (
    <Paper component="section" variant="outlined" aria-labelledby={headingId} sx={{
      p: 2, position: 'relative', display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0,
      ...(to && {
        transition: 'border-color 150ms', '&:hover': { borderColor: 'primary.main' },
        '&:focus-within': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
      }),
    }}>
      <Typography id={headingId} component="h2" variant="subtitle2" color="text.secondary"
        sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Icon fontSize="small" aria-hidden="true" />
        {to ? (
          <Link component={RouterLink} to={to} color="inherit" underline="none"
            sx={{ '&::after': { content: '""', position: 'absolute', inset: 0 }, '&:focus-visible': { outline: 'none' } }}>
            {title}
          </Link>
        ) : title}
      </Typography>
      {children}
    </Paper>
  )
}

function Cards({ allocations, deliverables }) {
  const today = localToday()
  const projects = myProjects(allocations)
  if (projects.length === 0) {
    return (
      <EmptyState icon={FolderOutlined} title="You are not assigned to any project yet"
        action={{ label: 'Open My work', to: '/my-work' }}>
        When a manager adds you to a project, your hours and deadlines show up here. Ask your manager if you
        expected to be on one.
      </EmptyState>
    )
  }
  const hours = hoursThisWeek(allocations, today)
  const next = nextDeadline(deliverables, today)
  const urgent = overdueOrSoon(deliverables, today)
  const summary = workloadSummary(allocations, today)
  return (
    <>
      {summary && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 2 }}>
          <Typography>{summary}</Typography>
          <Sparkline values={weeksFromAllocations(weeksFrom(today, SPARK_WEEKS), allocations).map((w) => w.total_hours)}
            what={`Your hours per week, next ${SPARK_WEEKS} weeks`} unit=" h" limit={MAX_HOURS} />
        </Box>
      )}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' } }}>
        <HomeCard id="card-week" title="This week" icon={ScheduleOutlined} to="/my-work">
          <Typography component="p" variant="h4" sx={{ fontWeight: 700 }}>{hours} of {MAX_HOURS} h</Typography>
          <Typography variant="body2" color="text.secondary">Booked across your projects</Typography>
        </HomeCard>
        {next ? (
          <HomeCard id="card-deadline" title="Next deadline" icon={EventOutlined} to={projectPath(next.project.id)}>
            <Typography component="p" variant="h6">{next.name}</Typography>
            <Typography variant="body2" color="text.secondary">{next.project.name} · Due {formatDate(next.due_date)}</Typography>
          </HomeCard>
        ) : (
          <HomeCard id="card-deadline" title="Next deadline" icon={EventOutlined}>
            <Typography variant="body2" color="text.secondary">Nothing due on your projects.</Typography>
          </HomeCard>
        )}
        {urgent.length > 0 && (
          <HomeCard id="card-urgent" title="Overdue or due soon" icon={WarningAmberOutlined}>
            <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0, display: 'grid', gap: 1 }}>
              {urgent.slice(0, 3).map((d) => (
                <li key={d.id}>
                  <Link component={RouterLink} to={projectPath(d.project.id)}>{d.name}</Link>
                  <Typography variant="body2" color={d.overdue ? 'error.main' : 'text.secondary'}>
                    {d.project.name} · {dueText(d, today)}
                  </Typography>
                </li>
              ))}
            </Box>
            {urgent.length > 3 && (
              <Typography variant="body2" color="text.secondary">and {urgent.length - 3} more</Typography>
            )}
          </HomeCard>
        )}
        <HomeCard id="card-projects" title="My projects" icon={FolderOutlined}>
          <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0, display: 'grid', gap: 1 }}>
            {projects.map((p) => (
              <Box component="li" key={p.id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <ProjectTile name={p.name} size={28} />
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600 }} noWrap>{p.name}</Typography>
                  <Typography variant="body2" color="text.secondary">Until {formatDate(p.end)}</Typography>
                </Box>
                <Link component={RouterLink} to={projectPath(p.id)} aria-label={`View ${p.name}`}>View</Link>
              </Box>
            ))}
          </Box>
        </HomeCard>
      </Box>
    </>
  )
}

export default function EmployeeHome({ userId }) {
  const load = useCallback(async (call) => {
    const [allocations, report] = await Promise.all([
      call((token) => allocationService.listAllocations(token, { employeeId: userId })),
      call((token) => reportService.deliverableStatus(token)),
    ])
    return { allocations, deliverables: report.deliverables }
  }, [userId])
  const result = useLoad(load)
  return (
    <LoadState result={result} label="Loading your work" skeleton="cards">
      {(data) => <Cards {...data} />}
    </LoadState>
  )
}
