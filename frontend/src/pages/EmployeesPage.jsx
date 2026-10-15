import { useCallback, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useMediaQuery } from 'react-responsive'
import { EMPLOYEE_LIST_ROLES, canManageEmployees } from '../auth/roles'
import { useApi, useLoad } from '../auth/useApi'
import { useAuth } from '../auth/useAuth'
import AppShell from '../components/AppShell'
import EmployeeFormDialog from '../components/EmployeeFormDialog'
import MaskedMoney from '../components/MaskedMoney'
import Paginated from '../components/Paginated'
import { FilterBar, SearchField, SelectFilter, SwitchFilter } from '../components/filters/Filters'
import { chosen, emptyText, matches, optionsFrom, optionsOf, searchTerm } from '../components/filters/filterMath'
import { anyValue, useUrlFilter, useUrlFlag } from '../hooks/useUrlFilter'
import PageHeader from '../components/PageHeader'
import { PersonName } from '../components/viz/Avatar'
import { LoadState } from '../components/PageState'
import { useToast } from '../components/toast/toast'
import * as employeeService from '../services/employeeService'
import * as teamService from '../services/teamService'
import { MUTED_ROW_SX } from '../theme'
import { messageFor as teamMessageFor } from './apiMessages'
import { messageFor } from './employeeMessages'
import { teamLabel } from './people'

const ROLE_LABELS = { admin: 'Admin', manager: 'Manager', employee: 'Employee' }
/** The Team filter's choice for people on no team. */
const NO_TEAM = 'none'
/** The Team column: a member's team, "Leads <team>" for a lead (filled, secondary colour), or a grey "No team". */
function TeamChip({ label, kind }) {
  if (kind === 'unknown') {
    return (
      <Tooltip title="You can only see the teams you lead.">
        <Typography component="span" color="text.secondary" tabIndex={0}>{label}</Typography>
      </Tooltip>
    )
  }
  if (kind === 'lead') return <Chip size="small" color="secondary" variant="outlined" label={label} sx={{ fontWeight: 600 }} />
  return (
    <Chip size="small" variant="outlined" label={label}
      sx={{ fontWeight: 500, color: kind === 'member' ? 'text.primary' : 'text.secondary' }} />
  )
}

/** Role chips: outlined, so they never read as a status; the label says the role. */
const ROLE_COLORS = { admin: 'primary', manager: 'secondary', employee: 'default' }
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Ask before archiving; the record is kept, the person can no longer sign in. */
function ArchiveDialog({ employee, onClose, onConfirm }) {
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleConfirm() {
    setError('')
    setSubmitting(true)
    try {
      await onConfirm()
    } catch (err) {
      setError(messageFor(err))
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onClose={submitting ? undefined : onClose} aria-labelledby="archive-title"
      aria-describedby="archive-description">
      <DialogTitle id="archive-title">Archive {employee.name}?</DialogTitle>
      <DialogContent>
        <DialogContentText id="archive-description">
          They will no longer be able to sign in. Their record is kept, not deleted.
        </DialogContentText>
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button color="error" variant="contained" onClick={handleConfirm} disabled={submitting}>
          Archive
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/**
 * The employee list. Admins and managers can open it; only admins see salaries
 * (masked until they click the eye, components/MaskedMoney.jsx) and the Add /
 * Edit / Archive buttons. The server enforces the same rules.
 */
export default function EmployeesPage() {
  const { user, role } = useAuth()
  const isPhone = useMediaQuery({ maxWidth: 599 })
  const allowed = EMPLOYEE_LIST_ROLES.includes(role)
  const isAdmin = canManageEmployees(role)

  // Filters in the address (?role=manager&team=…&archived=1) so a link can open them; search stays here.
  const [showArchived, setShowArchived] = useUrlFlag('archived')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useUrlFilter('role', Object.keys(ROLE_LABELS))
  const [teamParam, setTeamFilter] = useUrlFilter('team', anyValue) // a team id, NO_TEAM, or '' for all
  const toast = useToast()
  const [warning, setWarning] = useState('')
  const [problem, setProblem] = useState('') // why an unarchive was refused
  const [restoring, setRestoring] = useState(null) // id of the employee being unarchived
  // null, { kind: 'create' }, { kind: 'edit', employee } or { kind: 'archive', employee }
  const [dialog, setDialog] = useState(null)

  const api = useApi()

  // The list: skeleton while loading, a fixed message and "Try again" on failure.
  // Nothing is requested for a role that may not see it.
  const loadEmployees = useCallback(
    (call) => (allowed
      ? call((token) => employeeService.listEmployees(token, { includeArchived: isAdmin && showArchived }))
      : Promise.resolve([])),
    [allowed, isAdmin, showArchived],
  )
  const employees = useLoad(loadEmployees)

  // Team names for the Team column and the form. A manager gets only the teams they lead.
  const loadTeams = useCallback(
    (call) => (allowed ? call((token) => teamService.listTeams(token)) : Promise.resolve([])),
    [allowed],
  )
  const teamsResult = useLoad(loadTeams)
  const teams = teamsResult.status === 'ready' ? teamsResult.data : null // null until loaded (or if loading failed)

  function finish(message, teamWarning = '') {
    setDialog(null)
    toast(message)
    setWarning(teamWarning)
    employees.reload()
    teamsResult.reload()
  }

  /**
   * Membership lives on the team (POST/DELETE /api/teams/{id}/members), so a
   * team change is a second step after the employee is saved. If it fails, the
   * employee is still saved and a warning says what is left to do.
   */
  async function moveToTeam(employee, fromTeamId, toTeamId) {
    if ((fromTeamId ?? null) === toTeamId) return ''
    try {
      if (fromTeamId) await api((token) => teamService.removeMember(token, fromTeamId, employee.id))
      if (toTeamId) await api((token) => teamService.addMember(token, toTeamId, employee.id))
      return ''
    } catch (error) {
      return `${employee.name} was saved, but their team was not changed: ${teamMessageFor(error)}`
    }
  }

  async function handleCreate(payload, teamId) {
    const created = await api((token) => employeeService.createEmployee(token, payload))
    const teamWarning = await moveToTeam(created, null, teamId)
    finish(`Employee added: ${created.name}`, teamWarning)
  }

  async function handleEdit(payload, teamId) {
    const { employee } = dialog
    const updated = await api((token) => employeeService.updateEmployee(token, employee.id, payload))
    const teamWarning = await moveToTeam(updated, employee.team_id, teamId)
    finish(`Employee updated: ${updated.name}`, teamWarning)
  }

  async function handleArchive() {
    const archived = await api((token) => employeeService.archiveEmployee(token, dialog.employee.id))
    finish(`Employee archived: ${archived.name}`)
  }

  /** Bring an archived person back: the record only (their old team and assignments stay as they were). */
  async function handleUnarchive(employee) {
    setProblem('')
    setRestoring(employee.id)
    try {
      const restored = await api((token) => employeeService.unarchiveEmployee(token, employee.id))
      finish(`Employee unarchived: ${restored.name}`)
    } catch (error) {
      setProblem(`${employee.name}: ${messageFor(error)}`)
    } finally {
      setRestoring(null)
    }
  }

  if (!allowed) {
    return (
      <AppShell>
        <PageHeader title="Employees" />
        <Alert severity="info">You don&apos;t have permission to view the employee list.</Alert>
      </AppShell>
    )
  }

  const teamOptions = [{ value: NO_TEAM, label: 'No team' },
    ...optionsFrom(teams ?? [], (t) => ({ value: t.id, label: t.name }))]
  const teamFilter = chosen(teamParam, teamOptions)

  // Columns: email, job title and team move under the name on a phone.
  const columnCount = (isPhone ? 2 : 5) + (isAdmin ? 2 : 0)

  return (
    <AppShell>
      <PageHeader title="Employees"
        subtitle={isAdmin ? 'Everyone at ACME. Archive people instead of deleting them.' : 'The people in the teams you lead and across ACME.'}
        actions={isAdmin && (
          <Button variant="contained" onClick={() => setDialog({ kind: 'create' })}>
            Add employee
          </Button>
        )} />

      <FilterBar label="Filter employees" columns={isAdmin ? '2fr 1fr 1fr auto' : '2fr 1fr 1fr'}>
        <SearchField label="Search employees" value={search} onChange={setSearch} />
        <SelectFilter label="Role" allLabel="All roles" value={roleFilter} onChange={setRoleFilter}
          options={optionsOf(ROLE_LABELS)} />
        <SelectFilter label="Team" allLabel="All teams" value={teamFilter} onChange={setTeamFilter}
          options={teamOptions} />
        {isAdmin && <SwitchFilter label="Show archived" checked={showArchived} onChange={setShowArchived} />}
      </FilterBar>

      {problem && (
        <Alert severity="error" role="alert" onClose={() => setProblem('')} sx={{ mb: 2 }}>{problem}</Alert>
      )}

      {warning && (
        <Alert severity="warning" onClose={() => setWarning('')} sx={{ mb: 2 }}>{warning}</Alert>
      )}

      <LoadState result={employees} label="Loading employees" skeleton="table">
        {(all) => {
          const term = searchTerm(search)
          const rows = all.filter((e) => matches(term, e.name, e.email, e.job_title, teamLabel(e, teams ?? [], isAdmin).label)
            && (!roleFilter || e.role === roleFilter)
            && (!teamFilter || (teamFilter === NO_TEAM ? !e.team_id : e.team_id === teamFilter)))
          const empty = emptyText('employees', {
            term, filtered: Boolean(roleFilter || teamFilter), none: 'No employees to show.',
          })
          return (
        <Paginated rows={rows} label="Employees">
        {(pageRows) => (
        <TableContainer component={Paper}>
          <Table aria-label="Employees" size={isPhone ? 'small' : 'medium'}>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                {!isPhone && <TableCell>Email</TableCell>}
                {!isPhone && <TableCell>Job title</TableCell>}
                {!isPhone && <TableCell>Team</TableCell>}
                <TableCell>Role</TableCell>
                {isAdmin && <TableCell align="right">Salary</TableCell>}
                {isAdmin && <TableCell align="right">Actions</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {pageRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={columnCount}>{empty}</TableCell>
                </TableRow>
              )}
              {pageRows.map((employee) => {
                const archived = Boolean(employee.archived_at)
                const isSelf = employee.id === user?.id
                return (
                  <TableRow key={employee.id} hover data-muted={archived || undefined} sx={archived ? MUTED_ROW_SX : undefined}>
                    <TableCell component="th" scope="row">
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <PersonName name={employee.name} size={30} />
                        {archived && <Chip label="Archived" size="small" />}
                      </Box>
                      {isPhone && (
                        <Typography variant="body2" color="text.secondary">
                          {employee.job_title}
                          <br />
                          {teamLabel(employee, teams ?? [], isAdmin).label}
                          <br />
                          {employee.email}
                        </Typography>
                      )}
                    </TableCell>
                    {!isPhone && <TableCell>{employee.email}</TableCell>}
                    {!isPhone && <TableCell>{employee.job_title}</TableCell>}
                    {!isPhone && (
                      <TableCell>
                        <TeamChip {...teamLabel(employee, teams ?? [], isAdmin)} />
                      </TableCell>
                    )}
                    <TableCell>
                      <Chip size="small" variant="outlined" color={ROLE_COLORS[employee.role] ?? 'default'}
                        label={ROLE_LABELS[employee.role] ?? employee.role} />
                    </TableCell>
                    {isAdmin && (
                      <TableCell align="right">
                        <MaskedMoney amount={employee.salary} format={money.format} what="salary" name={employee.name} />
                      </TableCell>
                    )}
                    {isAdmin && (
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        {archived && (
                          <Button size="small" aria-label={`Unarchive ${employee.name}`}
                            disabled={restoring === employee.id} onClick={() => handleUnarchive(employee)}>
                            Unarchive
                          </Button>
                        )}
                        {!archived && (
                          <>
                            <Button size="small" aria-label={`Edit ${employee.name}`}
                              onClick={() => setDialog({ kind: 'edit', employee })}>
                              Edit
                            </Button>
                            <Button size="small" color="error" aria-label={`Archive ${employee.name}`}
                              disabled={isSelf}
                              onClick={() => setDialog({ kind: 'archive', employee })}>
                              Archive
                            </Button>
                          </>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
        )}
        </Paginated>
          )
        }}
      </LoadState>

      {dialog?.kind === 'create' && (
        <EmployeeFormDialog teams={teams} onClose={() => setDialog(null)} onSubmit={handleCreate} />
      )}
      {dialog?.kind === 'edit' && (
        <EmployeeFormDialog employee={dialog.employee} teams={teams} onClose={() => setDialog(null)}
          onSubmit={handleEdit} />
      )}
      {dialog?.kind === 'archive' && (
        <ArchiveDialog employee={dialog.employee} onClose={() => setDialog(null)}
          onConfirm={handleArchive} />
      )}
    </AppShell>
  )
}
