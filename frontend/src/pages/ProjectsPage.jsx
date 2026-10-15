import { useCallback, useEffect, useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import GridViewOutlined from '@mui/icons-material/GridViewOutlined'
import TableRowsOutlined from '@mui/icons-material/TableRowsOutlined'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { canCreateProjects, canManageProject } from '../auth/roles'
import { useApi, useLoad } from '../auth/useApi'
import { useAuth } from '../auth/useAuth'
import AppShell from '../components/AppShell'
import EmptyState from '../components/EmptyState'
import ConfirmDialog from '../components/ConfirmDialog'
import PageHeader from '../components/PageHeader'
import { LoadState } from '../components/PageState'
import ProjectFormDialog from '../components/ProjectFormDialog'
import ResponsiveTable from '../components/ResponsiveTable'
import StatusChip from '../components/StatusChip'
import { useMotion } from '../components/motion/motion'
import { useToast } from '../components/toast/toast'
import ProjectTile, { ProjectName } from '../components/viz/ProjectTile'
import * as projectService from '../services/projectService'
import * as teamService from '../services/teamService'
import { MUTED_ROW_SX, clickableCardSx } from '../theme'
import { FilterBar, SearchField, SelectFilter, SwitchFilter } from '../components/filters/Filters'
import { SEARCH_DELAY_MS, emptyText, optionsOf, searchTerm } from '../components/filters/filterMath'
import { anyValue, useUrlFilter, useUrlFlag } from '../hooks/useUrlFilter'
import { messageFor } from './apiMessages'
import { PROJECT_STATUS, formatDate } from './format'

/** Where the table/cards choice is remembered (this browser only). */
export const VIEW_KEY = 'acme.projects.view'

function savedView() {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'cards' ? 'cards' : 'table'
  } catch {
    return 'table'
  }
}

/** The projects as cards: tile, name, team, status and dates (the same data as the table). */
function ProjectCards({ rows, empty, archiveButton }) {
  const motion = useMotion()
  if (rows.length === 0) return <EmptyState compact title={empty} />
  return (
    <Box component="ul" aria-label="Projects" sx={{
      listStyle: 'none', p: 0, m: 0, display: 'grid', gap: 2,
      gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))',
    }}>
      {rows.map((p, i) => (
        <Paper component="li" key={p.id} variant="outlined" data-muted={p.archived_at ? true : undefined} sx={[{
          p: 2, display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0,
        }, clickableCardSx, p.archived_at ? MUTED_ROW_SX : {}, motion('enter', i)]}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
            <ProjectTile name={p.name} size={40} />
            <Box sx={{ minWidth: 0 }}>
              <Typography component="h2" variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.3, overflowWrap: 'anywhere' }}>
                <Link component={RouterLink} to={`/projects/${encodeURIComponent(p.id)}`}>{p.name}</Link>
              </Typography>
              <Typography variant="body2" color="text.secondary">{p.team?.name}</Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
            <StatusChip status={p.status} />
            {p.archived_at && <Chip label="Archived" size="small" />}
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 'auto' }}>
            {formatDate(p.start_date)} – {formatDate(p.end_date)}
          </Typography>
          {archiveButton(p) && <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: -1 }}>{archiveButton(p)}</Box>}
        </Paper>
      ))}
    </Box>
  )
}

/** All projects the caller can see (§4 visibility), with server-side search, filters and archive. */
export default function ProjectsPage() {
  const { user, role } = useAuth()
  const api = useApi()
  const navigate = useNavigate()
  const mayCreate = canCreateProjects(role)

  const [search, setSearch] = useState('') // what is in the box
  const [query, setQuery] = useState('') // what was last sent as q (trimmed)
  // The filters live in the address (?status=active&team=…&archived=1), so Home's cards can
  // open the list filtered; an unknown status means all. The team goes to the server as asked.
  const [status, setStatus] = useUrlFilter('status', Object.keys(PROJECT_STATUS))
  const [teamId, setTeamId] = useUrlFilter('team', anyValue)
  const [showArchived, setShowArchived] = useUrlFlag('archived')
  const toast = useToast()
  const [problem, setProblem] = useState('') // why an unarchive was refused
  const [restoring, setRestoring] = useState(null) // id of the project being unarchived
  const [dialog, setDialog] = useState(null) // null, { kind: 'create' } or { kind: 'archive', project }
  const [view, setView] = useState(savedView) // 'table' (default) or 'cards'

  function changeView(event, next) {
    if (!next) return
    setView(next)
    try {
      window.localStorage.setItem(VIEW_KEY, next)
    } catch {
      // Storage can be blocked (private mode): the choice just isn't remembered.
    }
  }

  // Search on the server, SEARCH_DELAY_MS after the last key. useLoad drops the
  // answer to an older search, so a slow reply never replaces a newer one.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(searchTerm(search)), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [search])

  const loadProjects = useCallback(
    (call) => call((token) => projectService.listProjects(token, {
      teamId: teamId || undefined, status: status || undefined, q: query || undefined,
      includeArchived: mayCreate && showArchived,
    })),
    [teamId, status, query, mayCreate, showArchived],
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

  function clearSearch() {
    setSearch('')
    setQuery('') // at once, not after the search delay
  }

  const emptyMessage = emptyText('projects', {
    term: query, filtered: Boolean(status || teamId), none: 'No projects to show yet.',
  })

  async function handleCreate(payload) {
    const created = await api((token) => projectService.createProject(token, payload))
    toast(`Project created: ${created.name}`)
    navigate(`/projects/${encodeURIComponent(created.id)}`)
  }

  async function handleArchive() {
    const archived = await api((token) => projectService.archiveProject(token, dialog.project.id))
    setDialog(null)
    toast(`Project archived: ${archived.name}`)
    projects.reload()
  }

  async function handleUnarchive(project) {
    setProblem('')
    setRestoring(project.id)
    try {
      const restored = await api((token) => projectService.unarchiveProject(token, project.id))
      toast(`Project unarchived: ${restored.name}`)
      projects.reload()
    } catch (error) {
      setProblem(`${project.name}: ${messageFor(error)}`)
    } finally {
      setRestoring(null)
    }
  }

  return (
    <AppShell>
      <PageHeader title="Projects" subtitle="Every project you can see. Search, filter by status or team, and open one."
        actions={mayCreate && (
          <Button variant="contained" onClick={() => setDialog({ kind: 'create' })}
            disabled={teams.status !== 'ready' || (teams.data ?? []).length === 0}>
            New project
          </Button>
        )} />

      <FilterBar label="Filter projects" columns={mayCreate ? '2fr 1fr 1fr auto' : '2fr 1fr 1fr'}>
        <SearchField label="Search projects" value={search} onChange={setSearch} onClear={clearSearch} />
        <SelectFilter label="Status" allLabel="All statuses" value={status} onChange={setStatus}
          options={optionsOf(PROJECT_STATUS)} />
        <SelectFilter label="Team" allLabel="All teams" value={teamId} onChange={setTeamId}
          options={teamOptions.map((t) => ({ value: t.id, label: t.name }))} />
        {mayCreate && <SwitchFilter label="Show archived" checked={showArchived} onChange={setShowArchived} />}
      </FilterBar>

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <ToggleButtonGroup size="small" exclusive value={view} onChange={changeView} aria-label="Project view">
          <ToggleButton value="table" sx={{ gap: 0.75, px: 1.5 }}><TableRowsOutlined fontSize="small" />Table</ToggleButton>
          <ToggleButton value="cards" sx={{ gap: 0.75, px: 1.5 }}><GridViewOutlined fontSize="small" />Cards</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {problem && <Alert severity="error" role="alert" onClose={() => setProblem('')} sx={{ mb: 2 }}>{problem}</Alert>}

      <LoadState result={projects} label="Loading projects" skeleton="table">
        {(rows) => {
          const archiveButton = (p) => {
            if (!mayCreate || !canManageProject(role, user, p)) return null
            if (p.archived_at) {
              return (
                <Button size="small" aria-label={`Unarchive ${p.name}`} disabled={restoring === p.id}
                  onClick={() => handleUnarchive(p)}>
                  Unarchive
                </Button>
              )
            }
            return (
              <Button size="small" color="error" aria-label={`Archive ${p.name}`}
                onClick={() => setDialog({ kind: 'archive', project: p })}>
                Archive
              </Button>
            )
          }
          if (view === 'cards') return <ProjectCards rows={rows} empty={emptyMessage} archiveButton={archiveButton} />
          return (
            <ResponsiveTable label="Projects" rows={rows} empty={emptyMessage} muted={(p) => Boolean(p.archived_at)}
              columns={[
                { key: 'name', label: 'Project', primary: true, render: (p) => (
                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <ProjectName name={p.name}>
                      <Link component={RouterLink} to={`/projects/${encodeURIComponent(p.id)}`}>{p.name}</Link>
                    </ProjectName>
                    {p.archived_at && <Chip label="Archived" size="small" />}
                  </Box>
                ) },
                { key: 'team', label: 'Team', render: (p) => p.team?.name },
                { key: 'manager', label: 'Manager', render: (p) => p.manager?.name ?? '—' },
                { key: 'status', label: 'Status', render: (p) => <StatusChip status={p.status} /> },
                { key: 'dates', label: 'Dates', render: (p) => `${formatDate(p.start_date)} – ${formatDate(p.end_date)}` },
                { key: 'actions', label: 'Actions', align: 'right', hidden: !mayCreate, render: archiveButton },
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
