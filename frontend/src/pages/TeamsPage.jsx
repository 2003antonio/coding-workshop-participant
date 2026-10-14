import { useCallback, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import { useMediaQuery } from 'react-responsive'
import { Link as RouterLink } from 'react-router-dom'
import { canManageTeams } from '../auth/roles'
import { useApi, useLoad } from '../auth/useApi'
import { useAuth } from '../auth/useAuth'
import AppShell from '../components/AppShell'
import { LoadState } from '../components/PageState'
import ResponsiveTable from '../components/ResponsiveTable'
import { TeamFormDialog } from '../components/TeamDialogs'
import * as employeeService from '../services/employeeService'
import * as teamService from '../services/teamService'
import { leadCandidates } from './people'

/**
 * Teams the caller can see: admin all, a manager the teams they lead, an
 * employee their own team. Only admins create teams.
 */
export default function TeamsPage() {
  const { role } = useAuth()
  const api = useApi()
  const isPhone = useMediaQuery({ maxWidth: 599 })
  const isAdmin = canManageTeams(role)
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState('')

  const load = useCallback((call) => call((token) => teamService.listTeams(token)), [])
  const teams = useLoad(load)
  const loadPeople = useCallback(
    (call) => (isAdmin ? call((token) => employeeService.listEmployees(token)) : Promise.resolve([])),
    [isAdmin],
  )
  const people = useLoad(loadPeople)

  async function handleCreate(payload) {
    const created = await api((token) => teamService.createTeam(token, payload))
    setCreating(false)
    setNotice(`${created.name} was created.`)
    teams.reload()
  }

  const emptyText = {
    admin: 'No teams yet. Create the first one.',
    manager: "You don't lead any teams yet.",
    employee: "You aren't on a team yet.",
  }[role]

  return (
    <AppShell maxWidth="lg">
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, mb: 2 }}>
        <Typography variant={isPhone ? 'h5' : 'h4'} component="h1" sx={{ flexGrow: 1 }}>Teams</Typography>
        {isAdmin && (
          <Button variant="contained" onClick={() => setCreating(true)} disabled={people.status !== 'ready'}>
            New team
          </Button>
        )}
      </Box>
      {notice && (
        <Alert severity="success" role="status" onClose={() => setNotice('')} sx={{ mb: 2 }}>{notice}</Alert>
      )}
      <LoadState result={teams} label="Loading teams">
        {(rows) => (
          <ResponsiveTable label="Teams" rows={rows} empty={emptyText} columns={[
            { key: 'name', label: 'Team', primary: true, render: (t) => (
              <Link component={RouterLink} to={`/teams/${encodeURIComponent(t.id)}`}>{t.name}</Link>
            ) },
            { key: 'lead', label: 'Lead', render: (t) => t.lead?.name ?? '—' },
            { key: 'members', label: 'Members', align: 'right', render: (t) => t.member_count },
          ]} />
        )}
      </LoadState>
      {creating && (
        <TeamFormDialog leads={leadCandidates(people.data ?? [])} onClose={() => setCreating(false)}
          onSubmit={handleCreate} />
      )}
    </AppShell>
  )
}
