import { useCallback, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { Link as RouterLink } from 'react-router-dom'
import { canManageTeams } from '../auth/roles'
import { useApi, useLoad } from '../auth/useApi'
import { useAuth } from '../auth/useAuth'
import AppShell from '../components/AppShell'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import Paginated from '../components/Paginated'
import { useToast } from '../components/toast/toast'
import { LoadState } from '../components/PageState'
import { useMotion } from '../components/motion/motion'
import Avatar, { AvatarStack } from '../components/viz/Avatar'
import ProjectTile from '../components/viz/ProjectTile'
import { TeamFormDialog } from '../components/TeamDialogs'
import * as employeeService from '../services/employeeService'
import * as teamService from '../services/teamService'
import { leadCandidates } from './people'
import { clickableCardSx } from '../theme'

/** Cards per page: rows of a 1-, 2-, 3- or 4-column grid stay full. */
const TEAM_PAGE_SIZES = [12, 24, 48]

/** One card per team: name, lead (with avatar), and the members as a stack with their count. */
function TeamCards({ rows, empty }) {
  const motion = useMotion()
  if (rows.length === 0) return <EmptyState compact title={empty} />
  return (
    <Box component="ul" aria-label="Teams" sx={{
      listStyle: 'none', p: 0, m: 0, display: 'grid', gap: 2,
      gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))',
    }}>
      {rows.map((t, i) => (
        <Paper component="li" key={t.id} variant="outlined" sx={[{
          p: 2, display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0,
        }, clickableCardSx, motion('enter', i)]}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
            <ProjectTile name={t.name} size={40} />
            <Typography component="h2" variant="subtitle1" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
              <Link component={RouterLink} to={`/teams/${encodeURIComponent(t.id)}`}>{t.name}</Link>
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {t.lead && <Avatar name={t.lead.name} size={28} decorative />}
            <Typography variant="body2">
              <Box component="span" sx={{ color: 'text.secondary' }}>Lead </Box>{t.lead?.name ?? '—'}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 'auto', flexWrap: 'wrap' }}>
            {t.members?.length > 0 && <AvatarStack names={t.members.map((m) => m.name)} size={26} />}
            <Typography variant="body2" color="text.secondary">
              {t.member_count} {t.member_count === 1 ? 'member' : 'members'}
            </Typography>
          </Box>
        </Paper>
      ))}
    </Box>
  )
}

/**
 * Teams the caller can see: admin all, a manager the teams they lead, an
 * employee their own team. Only admins create teams.
 */
export default function TeamsPage() {
  const { role } = useAuth()
  const api = useApi()
  const isAdmin = canManageTeams(role)
  const [creating, setCreating] = useState(false)
  const toast = useToast()

  // The list has member counts only; each team's own page has the names for the avatar stack
  // (a handful of teams, fetched together). A team whose details fail just shows its count.
  const load = useCallback(async (call) => {
    const rows = await call((token) => teamService.listTeams(token))
    const details = await Promise.all(rows.map((t) => call((token) => teamService.getTeam(token, t.id)).catch(() => null)))
    return rows.map((t, i) => ({ ...t, members: details[i]?.members }))
  }, [])
  const teams = useLoad(load)
  const loadPeople = useCallback(
    (call) => (isAdmin ? call((token) => employeeService.listEmployees(token)) : Promise.resolve([])),
    [isAdmin],
  )
  const people = useLoad(loadPeople)

  async function handleCreate(payload) {
    const created = await api((token) => teamService.createTeam(token, payload))
    setCreating(false)
    toast(`Team created: ${created.name}`)
    teams.reload()
  }

  const emptyText = {
    admin: 'No teams yet. Create the first one.',
    manager: "You don't lead any teams yet.",
    employee: "You aren't on a team yet.",
  }[role]

  return (
    <AppShell>
      <PageHeader title="Teams" subtitle="Who leads each team and how many people are on it."
        actions={isAdmin && (
          <Button variant="contained" onClick={() => setCreating(true)} disabled={people.status !== 'ready'}>
            New team
          </Button>
        )} />
      <LoadState result={teams} label="Loading teams" skeleton="cards">
        {(rows) => (
          <Paginated rows={rows} label="Teams" pageSize={12} pageSizes={TEAM_PAGE_SIZES}>
            {(pageRows) => <TeamCards rows={pageRows} empty={emptyText} />}
          </Paginated>
        )}
      </LoadState>
      {creating && (
        <TeamFormDialog leads={leadCandidates(people.data ?? [])} onClose={() => setCreating(false)}
          onSubmit={handleCreate} />
      )}
    </AppShell>
  )
}
