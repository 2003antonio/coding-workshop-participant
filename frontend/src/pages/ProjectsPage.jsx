import { useCallback, useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import FormControlLabel from '@mui/material/FormControlLabel'
import Link from '@mui/material/Link'
import MenuItem from '@mui/material/MenuItem'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useMediaQuery } from 'react-responsive'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { canCreateProjects, canManageProject } from '../auth/roles'
import { useApi, useLoad } from '../auth/useApi'
import { useAuth } from '../auth/useAuth'
import AppShell from '../components/AppShell'
import ConfirmDialog from '../components/ConfirmDialog'
import { LoadState } from '../components/PageState'
import ProjectFormDialog from '../components/ProjectFormDialog'
import ResponsiveTable from '../components/ResponsiveTable'
import StatusChip from '../components/StatusChip'
import * as projectService from '../services/projectService'
import * as teamService from '../services/teamService'
import { PROJECT_STATUS, formatDate } from './format'

/** All projects the caller can see (§4 visibility), with search, filters and archive. */
export default function ProjectsPage() {
  const { user, role } = useAuth()
  const api = useApi()
  const navigate = useNavigate()
  const isPhone = useMediaQuery({ maxWidth: 599 })
  const mayCreate = canCreateProjects(role)

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [teamId, setTeamId] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [notice, setNotice] = useState('')
  const [dialog, setDialog] = useState(null) // null, { kind: 'create' } or { kind: 'archive', project }

  const loadProjects = useCallback(
    (call) => call((token) => projectService.listProjects(token, {
      teamId: teamId || undefined, status: status || undefined, includeArchived: mayCreate && showArchived,
    })),
    [teamId, status, mayCreate, showArchived],
  )
  const projects = useLoad(loadProjects)
  const loadTeams = useCallback((call) => call((token) => teamService.listTeams(token)), [])
  const teams = useLoad(loadTeams)

  // Team filter: the teams the caller can see, plus any team a visible project belongs to
  // (an employee can be assigned to another team's project).
  const teamOptions = useMemo(() => {
    const byId = new Map((teams.data ?? []).map((t) => [t.id, t.name]))
    for (const p of projects.data ?? []) byId.set(p.team.id, p.team.name)
    return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [teams.data, projects.data])

  const needle = search.trim().toLowerCase()
  const matches = (p) => !needle || p.name.toLowerCase().includes(needle)
    || p.description?.toLowerCase().includes(needle)

  async function handleCreate(payload) {
    const created = await api((token) => projectService.createProject(token, payload))
    navigate(`/projects/${encodeURIComponent(created.id)}`)
  }

  async function handleArchive() {
    const archived = await api((token) => projectService.archiveProject(token, dialog.project.id))
    setDialog(null)
    setNotice(`${archived.name} was archived.`)
    projects.reload()
  }

  return (
    <AppShell maxWidth="lg">
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, mb: 2 }}>
        <Typography variant={isPhone ? 'h5' : 'h4'} component="h1" sx={{ flexGrow: 1 }}>Projects</Typography>
        {mayCreate && (
          <Button variant="contained" onClick={() => setDialog({ kind: 'create' })}
            disabled={teams.status !== 'ready' || (teams.data ?? []).length === 0}>
            New project
          </Button>
        )}
      </Box>

      <Box role="search" aria-label="Filter projects" sx={{
        display: 'grid', gap: 2, mb: 2, alignItems: 'center',
        gridTemplateColumns: isPhone ? '1fr' : '2fr 1fr 1fr auto',
      }}>
        <TextField label="Search projects" type="search" size="small" value={search}
          onChange={(e) => setSearch(e.target.value)} />
        <TextField select label="Status" size="small" value={status} onChange={(e) => setStatus(e.target.value)}>
          <MenuItem value="">All statuses</MenuItem>
          {Object.entries(PROJECT_STATUS).map(([value, label]) => (
            <MenuItem key={value} value={value}>{label}</MenuItem>
          ))}
        </TextField>
        <TextField select label="Team" size="small" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <MenuItem value="">All teams</MenuItem>
          {teamOptions.map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
        </TextField>
        {mayCreate && (
          <FormControlLabel label="Show archived" control={
            <Switch checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          } />
        )}
      </Box>

      {notice && (
        <Alert severity="success" role="status" onClose={() => setNotice('')} sx={{ mb: 2 }}>{notice}</Alert>
      )}

      <LoadState result={projects} label="Loading projects" skeleton="table">
        {(rows) => {
          const shown = rows.filter(matches)
          const filtered = Boolean(needle || status || teamId)
          return (
            <ResponsiveTable label="Projects" rows={shown}
              empty={filtered ? 'No projects match these filters.' : 'No projects to show yet.'}
              columns={[
                { key: 'name', label: 'Project', primary: true, render: (p) => (
                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Link component={RouterLink} to={`/projects/${encodeURIComponent(p.id)}`}>{p.name}</Link>
                    {p.archived_at && <Chip label="Archived" size="small" />}
                  </Box>
                ) },
                { key: 'team', label: 'Team', render: (p) => p.team?.name },
                { key: 'manager', label: 'Manager', render: (p) => p.manager?.name ?? '—' },
                { key: 'status', label: 'Status', render: (p) => <StatusChip status={p.status} /> },
                { key: 'dates', label: 'Dates', render: (p) => `${formatDate(p.start_date)} – ${formatDate(p.end_date)}` },
                { key: 'actions', label: 'Actions', align: 'right', hidden: !mayCreate, render: (p) => (
                  canManageProject(role, user, p) && !p.archived_at ? (
                    <Button size="small" color="error" aria-label={`Archive ${p.name}`}
                      onClick={() => setDialog({ kind: 'archive', project: p })}>
                      Archive
                    </Button>
                  ) : null
                ) },
              ]} />
          )
        }}
      </LoadState>

      {dialog?.kind === 'create' && (
        <ProjectFormDialog teams={teams.data} onClose={() => setDialog(null)} onSubmit={handleCreate} />
      )}
      {dialog?.kind === 'archive' && (
        <ConfirmDialog title={`Archive ${dialog.project.name}?`}
          description="Its deliverables and assignments are archived too. Nothing is deleted."
          confirmLabel="Archive" onClose={() => setDialog(null)} onConfirm={handleArchive} />
      )}
    </AppShell>
  )
}
