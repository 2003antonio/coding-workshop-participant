import { useCallback, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Typography from '@mui/material/Typography'
import { useMediaQuery } from 'react-responsive'
import { Link as RouterLink, useParams } from 'react-router-dom'
import { canManageProject } from '../auth/roles'
import { useApi, useLoad } from '../auth/useApi'
import { useAuth } from '../auth/useAuth'
import AllocationsSection from '../components/AllocationsSection'
import AppShell from '../components/AppShell'
import ConfirmDialog from '../components/ConfirmDialog'
import DeliverablesSection from '../components/DeliverablesSection'
import { LoadState } from '../components/PageState'
import ProjectBudgetSection from '../components/ProjectBudgetSection'
import ProjectFormDialog from '../components/ProjectFormDialog'
import StatusChip from '../components/StatusChip'
import * as projectService from '../services/projectService'
import * as teamService from '../services/teamService'
import { formatDate } from './format'

/** One project: details, deliverables, people and (for its manager and admins) the budget. */
export default function ProjectDetailPage() {
  const { id } = useParams()
  const { user, role } = useAuth()
  const api = useApi()
  const isPhone = useMediaQuery({ maxWidth: 599 })
  const [tab, setTab] = useState('deliverables')
  const [archiving, setArchiving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState('')
  const [version, setVersion] = useState(0) // bumped after an edit so the open section reloads

  const load = useCallback((call) => call((token) => projectService.getProject(token, id)), [id])
  const result = useLoad(load)
  // Only an admin may move a project to another team, so only an admin needs the team list.
  const loadTeams = useCallback(
    (call) => (role === 'admin' ? call((token) => teamService.listTeams(token)) : Promise.resolve(null)),
    [role],
  )
  const teams = useLoad(loadTeams)

  async function handleEdit(changes) {
    if (Object.keys(changes).length) {
      const updated = await api((token) => projectService.updateProject(token, id, changes))
      setNotice(`${updated.name} was updated.`)
      setVersion((v) => v + 1)
      result.reload()
    }
    setEditing(false)
  }

  async function handleArchive() {
    const archived = await api((token) => projectService.archiveProject(token, id))
    setArchiving(false)
    setNotice(`${archived.name} was archived.`)
    result.reload()
  }

  return (
    <AppShell maxWidth="lg">
      <Link component={RouterLink} to="/projects" sx={{ display: 'inline-block', mb: 2 }}>← All projects</Link>
      <LoadState result={result} label="Loading project" skeleton="detail">
        {(project) => {
          const canEdit = canManageProject(role, user, project) && !project.archived_at
          const tabs = [
            ['deliverables', 'Deliverables'],
            ['people', 'People'],
            ...(canManageProject(role, user, project) ? [['budget', 'Budget']] : []),
          ]
          const current = tabs.some(([key]) => key === tab) ? tab : 'deliverables'
          return (
            <>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 2, mb: 2 }}>
                <Box sx={{ flexGrow: 1 }}>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
                    <Typography variant={isPhone ? 'h5' : 'h4'} component="h1">{project.name}</Typography>
                    <StatusChip status={project.status} />
                    {project.archived_at && <Chip label="Archived" size="small" />}
                  </Box>
                  <Typography color="text.secondary">
                    {project.team.name} · Manager: {project.manager?.name ?? 'none'} ·{' '}
                    {formatDate(project.start_date)} – {formatDate(project.end_date)}
                  </Typography>
                  {project.description && <Typography sx={{ mt: 1 }}>{project.description}</Typography>}
                </Box>
                {canEdit && (
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button variant="outlined" onClick={() => setEditing(true)} disabled={teams.status === 'loading'}>
                      Edit project
                    </Button>
                    <Button color="error" variant="outlined" onClick={() => setArchiving(true)}>Archive project</Button>
                  </Box>
                )}
              </Box>
              {notice && <Alert severity="success" role="status" onClose={() => setNotice('')} sx={{ mb: 2 }}>{notice}</Alert>}

              <Paper variant="outlined" sx={{ mb: 2 }}>
                <Tabs value={current} onChange={(event, value) => setTab(value)} aria-label="Project sections"
                  variant={isPhone ? 'fullWidth' : 'standard'}>
                  {tabs.map(([key, label]) => (
                    <Tab key={key} value={key} label={label} id={`tab-${key}`} aria-controls={`panel-${key}`} />
                  ))}
                </Tabs>
              </Paper>
              <Box key={version} role="tabpanel" id={`panel-${current}`} aria-labelledby={`tab-${current}`}>
                {current === 'deliverables' && <DeliverablesSection project={project} canEdit={canEdit} />}
                {current === 'people' && <AllocationsSection project={project} canEdit={canEdit} role={role} />}
                {current === 'budget' && <ProjectBudgetSection project={project} role={role} />}
              </Box>

              {editing && (
                <ProjectFormDialog project={project} canChangeTeam={role === 'admin' && Boolean(teams.data)}
                  teams={teams.data ?? [project.team]} onClose={() => setEditing(false)} onSubmit={handleEdit} />
              )}
              {archiving && (
                <ConfirmDialog title={`Archive ${project.name}?`}
                  description="Its deliverables and assignments are archived too. Nothing is deleted."
                  confirmLabel="Archive" onClose={() => setArchiving(false)} onConfirm={handleArchive} />
              )}
            </>
          )
        }}
      </LoadState>
    </AppShell>
  )
}
