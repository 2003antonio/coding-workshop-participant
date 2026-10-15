// An employee's Home: four stat tiles, their projects as cards, what is coming up,
// who they work with, and the next 12 weeks as a small bar strip (the full chart
// is on My work). Data: their own allocations (§6), the deliverable report (§8,
// own projects), the projects they can see (team names, managers) and their own
// team (§3, names only). Nothing here carries pay data.
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
import * as allocationService from '../../services/allocationService'
import * as projectService from '../../services/projectService'
import * as reportService from '../../services/reportService'
import * as teamService from '../../services/teamService'
import ComingUp from '../ComingUp/ComingUp'
import EmptyState from '../EmptyState'
import { scheduleCounts, scheduleSegments, scheduleSentence } from '../health/healthMath'
import { useMotion } from '../motion/motion'
import { LoadState } from '../PageState'
import { MAX_HOURS, weeksFromAllocations } from '../mywork/weekMath'
import { AvatarStack } from '../viz/Avatar'
import DueChip from '../viz/DueChip'
import ProjectTile from '../viz/ProjectTile'
import RingGauge from '../viz/RingGauge'
import StatusBar from '../viz/StatusBar'
import { DUE_SOON_DAYS, hoursThisWeek, localToday, myProjects, nextDeadline, weeksFrom } from './homeMath'
import WeekStrip from './WeekStrip'
import { clickableCardSx } from '../../theme'

const projectPath = (id) => `/projects/${encodeURIComponent(id)}`

/** How many weeks the strip at the bottom shows. */
const STRIP_WEEKS = 12

/** A stretched link: the whole card is one link, named by its text, with a focus ring on the card. */
const stretched = {
  '&::after': { content: '""', position: 'absolute', inset: 0, borderRadius: 'inherit' },
  '&:focus-visible': { outline: 'none' },
}
const cardSx = {
  p: 2, position: 'relative', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1,
  ...clickableCardSx,
  '&:focus-within': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
}

/** One stat tile: a small heading that is the card's link, then the figure. */
function Tile({ id, title, icon: Icon, to, index, children }) {
  const motion = useMotion()
  return (
    <Paper component="section" variant="outlined" aria-labelledby={`${id}-heading`}
      sx={[cardSx, { minHeight: 112 }, motion('enter', index)]}>
      <Typography id={`${id}-heading`} component="h2" variant="subtitle2" color="text.secondary"
        sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Icon fontSize="small" aria-hidden="true" />
        <Link component={RouterLink} to={to} color="inherit" underline="none" sx={stretched}>{title}</Link>
      </Typography>
      {children}
    </Paper>
  )
}

function StatTiles({ hours, projectCount, next, overdue, today }) {
  const big = { component: 'p', variant: 'h4', sx: { fontWeight: 700, lineHeight: 1.1 } }
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' } }}>
      <Tile id="tile-week" title="This week" icon={ScheduleOutlined} to="/my-work" index={0}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <RingGauge value={hours} max={MAX_HOURS} size={52} thickness={6}
            label={`${hours} of ${MAX_HOURS} hours booked this week`} />
          <Typography component="p" sx={{ fontWeight: 700, fontSize: '1.25rem', whiteSpace: 'nowrap' }}>{hours} of {MAX_HOURS} h</Typography>
        </Box>
      </Tile>
      <Tile id="tile-projects" title="Projects" icon={FolderOutlined} to="/projects" index={1}>
        <Typography {...big}>{projectCount}</Typography>
        <Typography variant="body2" color="text.secondary">{projectCount === 1 ? 'project you work on' : 'projects you work on'}</Typography>
      </Tile>
      <Tile id="tile-deadline" title="Next deadline" icon={EventOutlined} to={next ? projectPath(next.project.id) : '/my-work'} index={2}>
        {next ? (
          <>
            <Typography component="p" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{next.name}</Typography>
            <Box><DueChip due={next.due_date} today={today} /></Box>
          </>
        ) : <Typography variant="body2" color="text.secondary">Nothing due on your projects.</Typography>}
      </Tile>
      <Tile id="tile-overdue" title="Overdue" icon={WarningAmberOutlined} to="/reports?tab=deliverables&overdue=1" index={3}>
        <Typography {...big} color={overdue > 0 ? 'error.main' : 'text.primary'}>{overdue}</Typography>
        <Typography variant="body2" color={overdue > 0 ? 'error.main' : 'text.secondary'} sx={{ fontWeight: overdue > 0 ? 600 : 400 }}>
          {overdue > 0 ? `${overdue === 1 ? 'deliverable needs' : 'deliverables need'} attention` : 'Nothing overdue'}
        </Typography>
      </Tile>
    </Box>
  )
}

/** One of my projects: tile, name (the card's link), team, my hours and its deliverables by status. */
function ProjectCard({ project, team, deliverables, index }) {
  const motion = useMotion()
  const counts = scheduleCounts(deliverables)
  return (
    <Paper component="li" variant="outlined" sx={[cardSx, motion('enter', index)]}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
        <ProjectTile name={project.name} size={40} />
        <Box sx={{ minWidth: 0 }}>
          <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.3, overflowWrap: 'anywhere' }}>
            <Link component={RouterLink} to={projectPath(project.id)} color="inherit" underline="hover" sx={stretched}>
              {project.name}
            </Link>
          </Typography>
          {team && <Typography variant="body2" color="text.secondary">{team}</Typography>}
        </Box>
      </Box>
      <Typography variant="body2"><Box component="strong">{project.hours} h</Box> per week for you</Typography>
      <StatusBar label={`Deliverables of ${project.name}`} segments={scheduleSegments(counts)} legend={false} height={8} />
      <Typography variant="body2" color="text.secondary">{scheduleSentence(counts)}</Typography>
    </Paper>
  )
}

function Body({ allocations, deliverables: all, projects, people }) {
  const today = localToday()
  const mine = myProjects(allocations)
  const ids = new Set(mine.map((p) => p.id))
  const deliverables = all.filter((d) => ids.has(d.project.id)) // the report may list more of my team's projects
  const teamOf = new Map(projects.map((p) => [p.id, p.team?.name]))
  const hours = hoursThisWeek(allocations, today)
  const next = nextDeadline(deliverables, today)
  const overdue = deliverables.filter((d) => d.status !== 'done' && (d.overdue || d.due_date < today)).length
  const tiles = <StatTiles hours={hours} projectCount={mine.length} next={next} overdue={overdue} today={today} />

  if (mine.length === 0) {
    return (
      <Box sx={{ display: 'grid', gap: 3 }}>
        {tiles}
        <EmptyState icon={FolderOutlined} title="You are not assigned to any project yet"
          action={{ label: 'Open My work', to: '/my-work' }}>
          When a manager adds you to a project, your hours and deadlines show up here. Ask your manager if you
          expected to be on one.
        </EmptyState>
      </Box>
    )
  }

  const weeks = weeksFromAllocations(weeksFrom(today, STRIP_WEEKS), allocations)
  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      {tiles}
      <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 2fr) minmax(0, 1fr)' }, alignItems: 'start' }}>
        <Box component="section" aria-labelledby="my-projects-heading" sx={{ minWidth: 0 }}>
          <Typography id="my-projects-heading" component="h2" variant="h6" sx={{ mb: 1.5 }}>My projects</Typography>
          <Box component="ul" aria-label="My projects" sx={{
            listStyle: 'none', p: 0, m: 0, display: 'grid', gap: 2,
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 230px), 1fr))',
          }}>
            {mine.map((p, i) => (
              <ProjectCard key={p.id} project={p} team={teamOf.get(p.id)} index={i}
                deliverables={deliverables.filter((d) => d.project.id === p.id)} />
            ))}
          </Box>
        </Box>
        <Box sx={{ display: 'grid', gap: 2, minWidth: 0 }}>
          <ComingUp deliverables={deliverables} days={DUE_SOON_DAYS} today={today} empty="Nothing due soon." />
          <Paper component="section" variant="outlined" aria-labelledby="people-heading" sx={{ p: 2, minWidth: 0 }}>
            <Typography id="people-heading" component="h2" variant="h6" sx={{ mb: 1 }}>Who you work with</Typography>
            {people.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No one else yet.</Typography>
            ) : (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <AvatarStack names={people} max={6} size={32} />
                <Typography variant="body2">
                  {people.length} {people.length === 1 ? 'person' : 'people'} on your team and leading your projects
                </Typography>
              </Box>
            )}
          </Paper>
        </Box>
      </Box>
      <WeekStrip weeks={weeks} footer={<Link component={RouterLink} to="/my-work">See full breakdown</Link>} />
    </Box>
  )
}

/** People I work with, names only: my team's members and lead, and my projects' managers (not me). */
async function loadPeople(call, userId, projects) {
  const teams = await call((token) => teamService.listTeams(token)).catch(() => [])
  const details = await Promise.all(teams.map((t) => call((token) => teamService.getTeam(token, t.id)).catch(() => null)))
  const names = new Map()
  for (const team of details.filter(Boolean)) {
    for (const m of team.members ?? []) names.set(m.id, m.name)
    if (team.lead) names.set(team.lead.id, team.lead.name)
  }
  for (const p of projects) if (p.manager) names.set(p.manager.id, p.manager.name)
  names.delete(userId)
  return [...names.values()].sort((a, b) => a.localeCompare(b))
}

export default function EmployeeHome({ userId }) {
  const load = useCallback(async (call) => {
    const [allocations, report, projects] = await Promise.all([
      call((token) => allocationService.listAllocations(token, { employeeId: userId })),
      call((token) => reportService.deliverableStatus(token)),
      call((token) => projectService.listProjects(token)).catch(() => []),
    ])
    const ids = new Set(myProjects(allocations).map((p) => p.id))
    const people = await loadPeople(call, userId, projects.filter((p) => ids.has(p.id)))
    return { allocations, deliverables: report.deliverables, projects, people }
  }, [userId])
  const result = useLoad(load)
  return (
    <LoadState result={result} label="Loading your work" skeleton="cards">
      {(data) => <Body {...data} />}
    </LoadState>
  )
}
