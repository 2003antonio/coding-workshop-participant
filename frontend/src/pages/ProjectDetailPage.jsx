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
import CloseProjectButton from '../components/CloseProjectButton'
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
import { useToast } from '../components/toast/toast'
import DependenciesSection from '../components/timeline/DependenciesSection'
import * as allocationService from '../services/allocationService'
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
  const [statusError, setStatusError] = useState('') // why a reopen was refused
  const toast = useToast()
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
  // What the Edit dialog checks new dates against (loaded only while it is open).
  const loadContents = useCallback(async (call) => {
    if (!editing) return null
    const [deliverables, allocations] = await Promise.all([
      call((token) => projectService.listDeliverables(token, id)),
      call((token) => allocationService.listAllocations(token, { projectId: id })),
    ])
    return { deliverables, allocations }
  }, [editing, id])
  const contents = useLoad(loadContents)

  async function handleEdit(changes) {
    if (Object.keys(changes).length) {
      const updated = await api((token) => projectService.updateProject(token, id, changes))
      toast(`Project updated: ${updated.name}`)
      refresh()
    }
    setEditing(false)
  }

  async function handleArchive() {
    const archived = await api((token) => projectService.archiveProject(token, id))
    setArchiving(false)
    toast(`Project archived: ${archived.name}`)
    refresh()
  }

  return (
    <AppShell>
      <ProjectRefreshContext.Provider value={refreshValue}>
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
                <PageHeader title={project.name} breadcrumbs={[{ label: 'Projects', to: '/projects' }, { label: project.name }]}
                  icon={<ProjectTile name={project.name} size={isPhone ? 40 : 48} />}
                  subtitle={`${project.team.name} · Manager: ${project.manager?.name ?? 'none'} · `
                    + `${formatDate(project.start_date)} – ${formatDate(project.end_date)}`}
                  actions={canEdit && (
                    <>
                      <Button variant="outlined" onClick={() => setEditing(true)} disabled={teams.status === 'loading'}>
                        Edit project
                      </Button>
                      <CloseProjectButton project={project} onError={setStatusError} />
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

                {statusError && (
                  <Alert severity="error" role="alert" onClose={() => setStatusError('')} sx={{ mb: 2 }}>{statusError}</Alert>
                )}

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
                    teams={teams.data ?? [project.team]} contents={contents.data ?? undefined}
                    onClose={() => setEditing(false)} onSubmit={handleEdit} />
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
