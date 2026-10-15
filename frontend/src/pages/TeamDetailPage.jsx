import { useCallback, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { Link as RouterLink, useParams } from 'react-router-dom'
import { canManageTeams, canSeeTeamBudget } from '../auth/roles'
import { useApi, useLoad } from '../auth/useApi'
import { useAuth } from '../auth/useAuth'
import AppShell from '../components/AppShell'
import BudgetPanel from '../components/BudgetPanel'
import ConfirmDialog from '../components/ConfirmDialog'
import PageHeader from '../components/PageHeader'
import { LoadError, LoadState, LoadingSkeleton } from '../components/PageState'
import ResponsiveTable from '../components/ResponsiveTable'
import { PersonName } from '../components/viz/Avatar'
import ProjectTile from '../components/viz/ProjectTile'
import { AddMemberDialog, TeamFormDialog } from '../components/TeamDialogs'
import { useToast } from '../components/toast/toast'
import * as budgetService from '../services/budgetService'
import * as employeeService from '../services/employeeService'
import * as projectService from '../services/projectService'
import * as teamService from '../services/teamService'
import { ARCHIVE_NOTE } from './apiMessages'
import { ROLE_LABELS } from './format'
import { leadCandidates, memberCandidates, memberLeads } from './people'

/** Weekly and yearly salary totals for the lead and admins, or why they are hidden. */
function TeamBudget({ teamId }) {
  const load = useCallback(
    (call) => call((token) => budgetService.getTeamBudget(token, teamId)),
    [teamId],
  )
  const budget = useLoad(load)
  if (budget.status === 'loading') return <LoadingSkeleton variant="cards" label="Loading team budget" />
  if (budget.status === 'error') return <LoadError message={budget.error} onRetry={budget.reload} />
  const { weekly, yearly, member_count: count, hidden_reason: reason } = budget.data
  return (
    <BudgetPanel title="Team budget" hiddenReason={reason}
      figures={[['Weekly', weekly], ['Yearly', yearly]]}
      footnote={`Salaries of ${count} ${count === 1 ? 'member' : 'members'}. The lead is not included.`} />
  )
}

/** One team: lead, members, budget. Admins change the lead and add or remove members. */
export default function TeamDetailPage() {
  const { id } = useParams()
  const { user, role } = useAuth()
  const api = useApi()
  const isAdmin = canManageTeams(role)
  const toast = useToast()
  // null, { kind: 'edit' }, { kind: 'add' }, { kind: 'archive' } or { kind: 'remove', member }
  const [dialog, setDialog] = useState(null)

  const loadTeam = useCallback((call) => call((token) => teamService.getTeam(token, id)), [id])
  const team = useLoad(loadTeam)
  const loadPeople = useCallback(
    (call) => (isAdmin ? call((token) => employeeService.listEmployees(token)) : Promise.resolve([])),
    [isAdmin],
  )
  const people = useLoad(loadPeople)

  function finish(message) {
    setDialog(null)
    toast(message)
    team.reload()
    people.reload()
  }

  async function handleEdit({ removeMemberFirst, ...changes }) {
    if (Object.keys(changes).length === 0) {
      setDialog(null)
      return
    }
    // A member becomes the lead: leave the team first (the server refuses a lead who is a member).
    if (removeMemberFirst) await api((token) => teamService.removeMember(token, id, removeMemberFirst.id))
    const updated = await api((token) => teamService.updateTeam(token, id, changes))
    finish(removeMemberFirst ? `Lead changed: ${removeMemberFirst.name} (removed from members)` : `Team updated: ${updated.name}`)
  }

  async function handleAdd(employeeId) {
    const name = people.data.find((p) => p.id === employeeId)?.name
    await api((token) => teamService.addMember(token, id, employeeId))
    finish(`Member added: ${name}`)
  }

  async function handleRemove() {
    const { member } = dialog
    await api((token) => teamService.removeMember(token, id, member.id))
    finish(`Member removed: ${member.name}`)
  }

  async function handleArchive() {
    try {
      const archived = await api((token) => teamService.archiveTeam(token, id))
      finish(`Team archived: ${archived.name}`)
    } catch (error) {
      if (error?.code === 'has_active_projects') error.sentence = await blockers()
      throw error
    }
  }

  /** Why the archive was refused: the team's active projects (as links) and who would leave it. */
  async function blockers() {
    const projects = await api((token) => projectService.listProjects(token, { teamId: id })).catch(() => null)
    if (!projects?.length) return undefined // the fixed message for the code is shown instead
    const members = team.data?.member_count ?? 0
    return (
      <>
        {team.data?.name} can&apos;t be archived while it has {projects.length} active
        {projects.length === 1 ? ' project' : ' projects'}:{' '}
        {projects.map((p, i) => (
          <span key={p.id}>
            {i > 0 && ', '}
            <Link component={RouterLink} to={`/projects/${encodeURIComponent(p.id)}`}>{p.name}</Link>
          </span>
        ))}
        . {projects.length === 1 ? 'Archive it or move it' : 'Archive them or move them'} to another team first.
        {members > 0 && ` Its ${members} ${members === 1 ? 'member' : 'members'} will leave the team when it is archived.`}
      </>
    )
  }

  return (
    <AppShell>
      <LoadState result={team} label="Loading team" skeleton="detail">
        {(data) => (
          <Stack spacing={3}>
            <PageHeader title={data.name} breadcrumbs={[{ label: 'Teams', to: '/teams' }, { label: data.name }]}
              subtitle={`Lead: ${data.lead?.name ?? 'none'}`} icon={<ProjectTile name={data.name} size={48} />}
              actions={isAdmin && !data.archived_at && (
                <>
                  <Button variant="outlined" onClick={() => setDialog({ kind: 'edit' })}
                    disabled={people.status !== 'ready'}>
                    Edit team
                  </Button>
                  <Button variant="contained" onClick={() => setDialog({ kind: 'add' })}
                    disabled={people.status !== 'ready'}>
                    Add member
                  </Button>
                  <Button variant="outlined" color="error" onClick={() => setDialog({ kind: 'archive' })}>
                    Archive team
                  </Button>
                </>
              )} />
            {data.archived_at && <Alert severity="info">This team is archived.</Alert>}

            <Box component="section" aria-labelledby="members-heading">
              <Typography id="members-heading" variant="h6" component="h2" gutterBottom>
                Members ({data.member_count})
              </Typography>
              <ResponsiveTable label="Members" rows={data.members ?? []} empty="No members yet." columns={[
                { key: 'name', label: 'Name', primary: true, render: (m) => <PersonName name={m.name} /> },
                { key: 'job', label: 'Job title', render: (m) => m.job_title },
                { key: 'role', label: 'Role', render: (m) => ROLE_LABELS[m.role] ?? m.role },
                { key: 'actions', label: 'Actions', align: 'right', hidden: !isAdmin || Boolean(data.archived_at),
                  render: (m) => (
                    <Button size="small" color="error" aria-label={`Remove ${m.name}`}
                      onClick={() => setDialog({ kind: 'remove', member: m })}>
                      Remove
                    </Button>
                  ) },
              ]} />
            </Box>

            {canSeeTeamBudget(role, user, data) && <TeamBudget key={data.member_count} teamId={data.id} />}

            {dialog?.kind === 'edit' && (
              <TeamFormDialog team={data} leads={leadCandidates(people.data, data.id)}
                members={memberLeads(people.data, data.id)}
                onClose={() => setDialog(null)} onSubmit={handleEdit} />
            )}
            {dialog?.kind === 'add' && (
              <AddMemberDialog team={data} candidates={memberCandidates(people.data, data)}
                onClose={() => setDialog(null)} onSubmit={handleAdd} />
            )}
            {dialog?.kind === 'remove' && (
              <ConfirmDialog title={`Remove ${dialog.member.name} from ${data.name}?`}
                description="They keep their existing assignments. You can add them to another team afterwards."
                confirmLabel="Remove" onClose={() => setDialog(null)} onConfirm={handleRemove} />
            )}
            {dialog?.kind === 'archive' && (
              <ConfirmDialog title={`Archive ${data.name}?`}
                description={`${ARCHIVE_NOTE} Its members are taken off the team.`}
                confirmLabel="Archive" onClose={() => setDialog(null)} onConfirm={handleArchive} />
            )}
          </Stack>
        )}
      </LoadState>
    </AppShell>
  )
}
