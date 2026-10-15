import { useCallback, useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Typography from '@mui/material/Typography'
import { Link as RouterLink, useParams } from 'react-router-dom'
import { canManageProject } from '../auth/roles'
import { useApi, useLoad } from '../auth/useApi'
import { useAuth } from '../auth/useAuth'
import { useBreakpoint } from '../hooks/useBreakpoint'
import AllocationsSection from '../components/AllocationsSection'
import AppShell from '../components/AppShell'
import ConfirmDialog from '../components/ConfirmDialog'
import PageHeader from '../components/PageHeader'
import DeliverablesSection from '../components/DeliverablesSection'
import { LoadState } from '../components/PageState'
import ProjectBudgetSection from '../components/ProjectBudgetSection'
import ProjectHealthStrip from '../components/health/ProjectHealthStrip'
import ProjectTile from '../components/viz/ProjectTile'
import ProjectFormDialog from '../components/ProjectFormDialog'
import { ProjectRefreshContext } from '../components/projectRefresh'
import StatusChip from '../components/StatusChip'
import { useMotion } from '../components/motion/motion'
import DependenciesSection from '../components/timeline/DependenciesSection'
import * as projectService from '../services/projectService'
import * as teamService from '../services/teamService'
import { formatDate } from './format'

/** One project: details, deliverables, people and (for its manager and admins) the budget. */
export default function ProjectDetailPage() {
  const { id } = useParams()
  const { user, role } = useAuth()
  const api = useApi()
  const { isPhone } = useBreakpoint()
  const motion = useMotion()
  const [tab, setTab] = useState('deliverables')
  const [archiving, setArchiving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState('')
  // The page's one refresh: any change on it (project, deliverable, assignment) bumps
  // refreshKey, and the project, header budget, health strip and open tab load again.
  const [refreshKey, setRefreshKey] = useState(0)
  const refresh = useCallback(() => setRefreshKey((n) => n + 1), [])
  const refreshValue = useMemo(() => ({ refreshKey, refresh }), [refreshKey, refresh])

  const load = useCallback((call) => call((token) => projectService.getProject(token, id)), [id])
  const result = useLoad(load, refreshKey)
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
      refresh()
    }
    setEditing(false)
  }

  async function handleArchive() {
    const archived = await api((token) => projectService.archiveProject(token, id))
    setArchiving(false)
    setNotice(`${archived.name} was archived.`)
    refresh()
  }

  return (
    <AppShell>
      <ProjectRefreshContext.Provider value={refreshValue}>
        <Link component={RouterLink} to="/projects" sx={{ display: 'inline-block', mb: 2 }}>← All projects</Link>
        <LoadState result={result} label="Loading project" skeleton="detail">
          {(project) => {
            const canManage = canManageProject(role, user, project)
            const canEdit = canManage && !project.archived_at
            const tabs = [
              ['deliverables', 'Deliverables'],
              ['people', 'People'],
              ...(canManage ? [['budget', 'Budget']] : []),
              ['dependencies', 'Dependencies'],
            ]
            const current = tabs.some(([key]) => key === tab) ? tab : 'deliverables'
            return (
              <>
                <PageHeader title={project.name} icon={<ProjectTile name={project.name} size={isPhone ? 40 : 48} />}
                  subtitle={`${project.team.name} · Manager: ${project.manager?.name ?? 'none'} · `
                    + `${formatDate(project.start_date)} – ${formatDate(project.end_date)}`}
                  actions={canEdit && (
                    <>
                      <Button variant="outlined" onClick={() => setEditing(true)} disabled={teams.status === 'loading'}>
                        Edit project
                      </Button>
                      <Button color="error" variant="outlined" onClick={() => setArchiving(true)}>Archive project</Button>
                    </>
                  )}
                  after={(
                    <>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mt: 1 }}>
                        <StatusChip status={project.status} />
                        {project.archived_at && <Chip label="Archived" size="small" />}
                      </Box>
                      {project.description && <Typography sx={{ mt: 1 }}>{project.description}</Typography>}
                      <ProjectHealthStrip project={project} showBudget={canManage} ownOnly={role === 'employee'} />
                    </>
                  )} />
                {notice && <Alert severity="success" role="status" onClose={() => setNotice('')} sx={{ mb: 2 }}>{notice}</Alert>}

                <Paper variant="outlined" sx={{ mb: 2 }}>
                  <Tabs value={current} onChange={(event, value) => setTab(value)} aria-label="Project sections"
                    variant={isPhone ? 'scrollable' : 'standard'} scrollButtons="auto" allowScrollButtonsMobile>
                    {tabs.map(([key, label]) => (
                      <Tab key={key} value={key} label={label} id={`tab-${key}`} aria-controls={`panel-${key}`} />
                    ))}
                  </Tabs>
                </Paper>
                <Box key={current} role="tabpanel" id={`panel-${current}`} aria-labelledby={`tab-${current}`}
                  sx={motion('enter')}>
                  {current === 'deliverables' && <DeliverablesSection project={project} canEdit={canEdit} />}
                  {current === 'people' && <AllocationsSection project={project} canEdit={canEdit} role={role} />}
                  {current === 'budget' && <ProjectBudgetSection project={project} role={role} />}
                  {current === 'dependencies' && <DependenciesSection project={project} />}
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
      </ProjectRefreshContext.Provider>
    </AppShell>
  )
}
