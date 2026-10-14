import { useCallback, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useMediaQuery } from 'react-responsive'
import { Link as RouterLink, useParams } from 'react-router-dom'
import { canManageTeams, canSeeTeamBudget } from '../auth/roles'
import { useApi, useLoad } from '../auth/useApi'
import { useAuth } from '../auth/useAuth'
import AppShell from '../components/AppShell'
import BudgetPanel from '../components/BudgetPanel'
import ConfirmDialog from '../components/ConfirmDialog'
import { LoadError, LoadState, LoadingSkeleton } from '../components/PageState'
import ResponsiveTable from '../components/ResponsiveTable'
import { AddMemberDialog, TeamFormDialog } from '../components/TeamDialogs'
import * as budgetService from '../services/budgetService'
import * as employeeService from '../services/employeeService'
import * as teamService from '../services/teamService'
import { ARCHIVE_NOTE } from './apiMessages'
import { ROLE_LABELS } from './format'
import { leadCandidates, memberCandidates } from './people'

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
  const isPhone = useMediaQuery({ maxWidth: 599 })
  const isAdmin = canManageTeams(role)
  const [notice, setNotice] = useState('')
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
    setNotice(message)
    team.reload()
    people.reload()
  }

  async function handleEdit(changes) {
    if (Object.keys(changes).length === 0) {
      setDialog(null)
      return
    }
    const updated = await api((token) => teamService.updateTeam(token, id, changes))
    finish(`${updated.name} was updated.`)
  }

  async function handleAdd(employeeId) {
    const name = people.data.find((p) => p.id === employeeId)?.name
    await api((token) => teamService.addMember(token, id, employeeId))
    finish(`${name} was added to the team.`)
  }

  async function handleRemove() {
    const { member } = dialog
    await api((token) => teamService.removeMember(token, id, member.id))
    finish(`${member.name} was removed from the team.`)
  }

  async function handleArchive() {
    const archived = await api((token) => teamService.archiveTeam(token, id))
    finish(`${archived.name} was archived.`)
  }

  return (
    <AppShell maxWidth="lg">
      <Link component={RouterLink} to="/teams" sx={{ display: 'inline-block', mb: 2 }}>← All teams</Link>
      <LoadState result={team} label="Loading team" skeleton="detail">
        {(data) => (
          <Stack spacing={3}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
              <Box sx={{ flexGrow: 1 }}>
                <Typography variant={isPhone ? 'h5' : 'h4'} component="h1">{data.name}</Typography>
                <Typography color="text.secondary">Lead: {data.lead?.name ?? 'none'}</Typography>
              </Box>
              {isAdmin && !data.archived_at && (
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
              )}
            </Box>
            {notice && <Alert severity="success" role="status" onClose={() => setNotice('')}>{notice}</Alert>}
            {data.archived_at && <Alert severity="info">This team is archived.</Alert>}

            <Box component="section" aria-labelledby="members-heading">
              <Typography id="members-heading" variant="h6" component="h2" gutterBottom>
                Members ({data.member_count})
              </Typography>
              <ResponsiveTable label="Members" rows={data.members ?? []} empty="No members yet." columns={[
                { key: 'name', label: 'Name', primary: true, render: (m) => m.name },
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

            {canSeeTeamBudget(role, user, data) && <TeamBudget teamId={data.id} />}

            {dialog?.kind === 'edit' && (
              <TeamFormDialog team={data} leads={leadCandidates(people.data, data.id)}
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
