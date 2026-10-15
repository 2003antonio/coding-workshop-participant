import { useCallback } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Skeleton from '@mui/material/Skeleton'
import Typography from '@mui/material/Typography'
import { useLoad } from '../../auth/useApi'
import * as allocationService from '../../services/allocationService'
import * as projectService from '../../services/projectService'
import { localToday } from '../home/homeMath'
import { useMotion } from '../motion/motion'
import { ProjectBudgetBar, Updating } from '../ProjectBudgetSection'
import { useProjectRefresh } from '../projectRefresh'
import { AvatarStack } from '../viz/Avatar'
import StatusBar from '../viz/StatusBar'
import { peopleSentence, peopleThisWeek, scheduleCounts, scheduleSegments, scheduleSentence } from './healthMath'

/** One tile of the strip: a small heading, then its content. */
function Tile({ title, updating, index, children }) {
  const motion = useMotion()
  return (
    <Paper component="section" aria-label={title} variant="outlined"
      sx={[{ p: 2, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }, motion('enter', index)]}>
      <Typography variant="overline" component="h2" color="text.secondary" sx={{ lineHeight: 1.5, letterSpacing: '0.08em' }}>
        {title}{updating && <Updating />}
      </Typography>
      {children}
    </Paper>
  )
}

/** Loading, error (with retry) or the content of a tile, for one useLoad result. */
function TileBody({ result, what, children }) {
  if (result.status === 'loading') {
    return <Box role="status" aria-label={`Loading ${what}`}><Skeleton variant="rounded" height={10} /><Skeleton width="70%" /></Box>
  }
  if (result.status === 'error') {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="body2" color="text.secondary">The {what} didn&apos;t load.</Typography>
        <Button size="small" onClick={result.reload}>Try again</Button>
      </Box>
    )
  }
  return children(result.data)
}

/**
 * The top of a project page: Budget (only for people who manage the project;
 * employees never see a budget), Schedule (deliverables by status) and People
 * (who is assigned and their hours this week). Every tile reloads with the
 * page's one refresh (projectRefresh.js), keeping its numbers on screen meanwhile.
 */
export default function ProjectHealthStrip({ project, showBudget, ownOnly = false }) {
  const { refreshKey } = useProjectRefresh()
  const loadDeliverables = useCallback(
    (call) => call((token) => projectService.listDeliverables(token, project.id)),
    [project.id],
  )
  const deliverables = useLoad(loadDeliverables, refreshKey)
  const loadPeople = useCallback(
    (call) => call((token) => allocationService.listAllocations(token, { projectId: project.id })),
    [project.id],
  )
  const people = useLoad(loadPeople, refreshKey)
  const today = localToday()

  return (
    <Box data-testid="health-strip" sx={{
      display: 'grid', gap: 2, mt: 2,
      gridTemplateColumns: { xs: '1fr', md: showBudget ? 'repeat(3, minmax(0, 1fr))' : 'repeat(2, minmax(0, 1fr))' },
    }}>
      {showBudget && (
        <Tile title="Budget" index={0}>
          <ProjectBudgetBar project={project} bare />
        </Tile>
      )}
      <Tile title="Schedule" updating={deliverables.updating} index={1}>
        <TileBody result={deliverables} what="schedule">
          {(rows) => {
            const counts = scheduleCounts(rows)
            return (
              <>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{scheduleSentence(counts)}</Typography>
                <StatusBar label="Deliverables by status" segments={scheduleSegments(counts)} />
              </>
            )
          }}
        </TileBody>
      </Tile>
      <Tile title="People" updating={people.updating} index={2}>
        <TileBody result={people} what="people">
          {(rows) => {
            const week = peopleThisWeek(rows, today)
            return (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                {week.names.length > 0 && <AvatarStack names={week.names} />}
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{peopleSentence(week, ownOnly)}</Typography>
              </Box>
            )
          }}
        </TileBody>
      </Tile>
    </Box>
  )
}
