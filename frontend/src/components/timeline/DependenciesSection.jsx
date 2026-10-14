import { useCallback, useState } from 'react'
import Box from '@mui/material/Box'
import Skeleton from '@mui/material/Skeleton'
import { useMediaQuery } from 'react-responsive'
import { useLoad } from '../../auth/useApi'
import * as reportService from '../../services/reportService'
import { Empty, LoadError } from '../PageState'
import DependencyTimeline from './DependencyTimeline'

/** Grey bars in the shape of the timeline while it loads. */
function TimelineSkeleton() {
  return (
    <Box role="status" aria-label="Loading dependencies">
      <Skeleton variant="text" width="40%" sx={{ mb: 2 }} />
      {[30, 55, 40, 70].map((width, i) => (
        <Box key={width} sx={{ display: 'flex', alignItems: 'center', gap: 2, height: 44 }}>
          <Skeleton variant="text" width={140} />
          <Skeleton variant="rounded" height={24} sx={{ ml: `${i * 12}%`, width: `${width - i * 8}%` }} />
        </Box>
      ))}
    </Box>
  )
}

/** The project's Dependencies tab: report 6 (§8) drawn as a timeline. Read-only for everyone. */
export default function DependenciesSection({ project }) {
  const isPhone = useMediaQuery({ maxWidth: 599 })
  const isTablet = useMediaQuery({ maxWidth: 899 })
  const [today] = useState(() => new Date().toISOString().slice(0, 10))
  const load = useCallback(
    (call) => call((token) => reportService.dependencyChain(token, { projectId: project.id })),
    [project.id],
  )
  const result = useLoad(load)

  if (result.status === 'loading') return <TimelineSkeleton />
  if (result.status === 'error') return <LoadError message={result.error} onRetry={result.reload} />
  if (result.data.nodes.length === 0) return <Empty>No deliverables yet.</Empty>
  return <DependencyTimeline chain={result.data} today={today} isPhone={isPhone} labelWidth={isTablet ? 150 : 220} />
}
