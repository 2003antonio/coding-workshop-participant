import { useCallback, useState } from 'react'
import AssignmentIndOutlined from '@mui/icons-material/AssignmentIndOutlined'
import BadgeOutlined from '@mui/icons-material/BadgeOutlined'
import FolderOutlined from '@mui/icons-material/FolderOutlined'
import GroupsOutlined from '@mui/icons-material/GroupsOutlined'
import HistoryOutlined from '@mui/icons-material/HistoryOutlined'
import LoginOutlined from '@mui/icons-material/LoginOutlined'
import TaskAltOutlined from '@mui/icons-material/TaskAltOutlined'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { canSeeActivity } from '../auth/roles'
import { useApi, useLoad } from '../auth/useApi'
import { useAuth } from '../auth/useAuth'
import { exactTime, groupRepeats, timeAgo } from '../components/activity/activityTime'
import AppShell from '../components/AppShell'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import { LoadState } from '../components/PageState'
import { useMotion } from '../components/motion/motion'
import Avatar from '../components/viz/Avatar'
import * as activityService from '../services/activityService'
import { messageFor } from './apiMessages'

/** Rows per request; "Load more" asks for the next page. */
export const PAGE_SIZE = 20

/** The filter chips: [type, label, icon]. Managers never get People or Sign-ins (the server scopes them out too). */
const TYPES = [
  ['people', 'People', BadgeOutlined],
  ['teams', 'Teams', GroupsOutlined],
  ['projects', 'Projects', FolderOutlined],
  ['deliverables', 'Deliverables', TaskAltOutlined],
  ['assignments', 'Assignments', AssignmentIndOutlined],
  ['sign-ins', 'Sign-ins', LoginOutlined],
]
const ADMIN_ONLY = new Set(['people', 'teams', 'sign-ins'])
const ICON = Object.fromEntries(TYPES.map(([type, , Icon]) => [type, Icon]))

/** One feed row: who (avatar), the sentence, when (relative, exact in a tooltip), and the kind as an icon. */
function ActivityRow({ row, index }) {
  const motion = useMotion()
  const Icon = ICON[row.type] ?? HistoryOutlined
  return (
    <Box component="li" sx={[{
      display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', gap: 1.5, alignItems: 'start',
      py: 1.5, px: 2, borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0 },
    }, motion('fade', index)]}>
      {row.actor ? <Avatar name={row.actor.name} size={32} decorative /> : (
        <Box aria-hidden="true" sx={{
          width: 32, height: 32, borderRadius: '50%', display: 'grid', placeItems: 'center',
          bgcolor: 'action.selected', color: 'text.secondary',
        }}><HistoryOutlined fontSize="small" /></Box>
      )}
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ overflowWrap: 'anywhere' }}>
          {row.sentence}
          {row.times > 1 && (
            <Chip size="small" label={`×${row.times}`} aria-label={`${row.times} times in a row`}
              sx={{ ml: 1, height: 20, fontSize: 12 }} />
          )}
        </Typography>
        <Tooltip title={exactTime(row.occurred_at)}>
          <Typography component="time" dateTime={row.occurred_at} variant="body2" color="text.secondary"
            tabIndex={0} sx={{ display: 'inline-block' }}>
            {timeAgo(row.occurred_at)}
          </Typography>
        </Tooltip>
      </Box>
      <Box aria-hidden="true" sx={{ color: 'text.secondary', pt: 0.25 }}><Icon fontSize="small" /></Box>
    </Box>
  )
}

/** The feed for one filter: the first page from useLoad, further pages appended by "Load more". */
function Feed({ type }) {
  const api = useApi()
  const [more, setMore] = useState([]) // rows from "Load more" pages
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState('')
  const load = useCallback(
    (call) => call((token) => activityService.listActivity(token, { type: type || undefined, limit: PAGE_SIZE })),
    [type],
  )
  const first = useLoad(load)

  async function loadMore(offset) {
    setLoadingMore(true)
    setMoreError('')
    try {
      const page = await api((token) => activityService.listActivity(token, { type: type || undefined, limit: PAGE_SIZE, offset }))
      setMore((rows) => [...rows, ...page.activity])
    } catch (error) {
      setMoreError(messageFor(error))
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <LoadState result={first} label="Loading activity" skeleton="list">
      {(data) => {
        const rows = [...data.activity, ...more]
        if (rows.length === 0) {
          return (
            <EmptyState icon={HistoryOutlined} title="Nothing has happened yet.">
              Changes to projects and people will show up here.
            </EmptyState>
          )
        }
        return (
          <>
            <Paper variant="outlined" component="ol" aria-label="Activity" sx={{ listStyle: 'none', p: 0, m: 0 }}>
              {groupRepeats(rows).map((row, i) => <ActivityRow key={row.id} row={row} index={i} />)}
            </Paper>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 2, flexWrap: 'wrap' }}>
              <Typography variant="body2" color="text.secondary">Showing {rows.length} of {data.total}</Typography>
              {rows.length < data.total && (
                <Button variant="outlined" onClick={() => loadMore(rows.length)} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : 'Load more'}
                </Button>
              )}
            </Box>
            {moreError && (
              <Alert severity="error" sx={{ mt: 2 }} action={(
                <Button color="inherit" size="small" onClick={() => loadMore(rows.length)}>Try again</Button>
              )}>
                {moreError}
              </Alert>
            )}
          </>
        )
      }}
    </LoadState>
  )
}

/** Who did what and when (the audit log). Admin sees everything; a manager their teams' projects. */
export default function ActivityPage() {
  const { role } = useAuth()
  const [type, setType] = useState('')

  if (!canSeeActivity(role)) {
    return (
      <AppShell>
        <PageHeader title="Activity" />
        <Alert severity="info">You don&apos;t have permission to view activity.</Alert>
      </AppShell>
    )
  }

  const chips = TYPES.filter(([key]) => role === 'admin' || !ADMIN_ONLY.has(key))
  return (
    <AppShell>
      <PageHeader title="Activity"
        subtitle={role === 'admin' ? 'Who changed what, and when, across ACME.'
          : 'Who changed what, and when, on the projects of the teams you lead.'} />
      <Box role="group" aria-label="Filter activity" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
        {[['', 'All', HistoryOutlined], ...chips].map(([key, label, Icon]) => (
          <Chip key={label} label={label} icon={<Icon aria-hidden="true" />} clickable aria-pressed={type === key}
            color={type === key ? 'primary' : 'default'} variant={type === key ? 'filled' : 'outlined'}
            onClick={() => setType(key)} />
        ))}
      </Box>
      <Feed key={type} type={type} />
    </AppShell>
  )
}
