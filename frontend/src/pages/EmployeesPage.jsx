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
import FormControlLabel from '@mui/material/FormControlLabel'
import Paper from '@mui/material/Paper'
import Switch from '@mui/material/Switch'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import { useMediaQuery } from 'react-responsive'
import { EMPLOYEE_LIST_ROLES, canManageEmployees } from '../auth/roles'
import { useApi, useLoad } from '../auth/useApi'
import { useAuth } from '../auth/useAuth'
import AppShell from '../components/AppShell'
import EmployeeFormDialog from '../components/EmployeeFormDialog'
import PageHeader from '../components/PageHeader'
import { LoadState } from '../components/PageState'
import * as employeeService from '../services/employeeService'
import * as teamService from '../services/teamService'
import { messageFor as teamMessageFor } from './apiMessages'
import { messageFor } from './employeeMessages'
import { teamName } from './people'

const ROLE_LABELS = { admin: 'Admin', manager: 'Manager', employee: 'Employee' }
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
 * and the Add / Edit / Archive buttons. The server enforces the same rules.
 */
export default function EmployeesPage() {
  const { user, role } = useAuth()
  const isPhone = useMediaQuery({ maxWidth: 599 })
  const allowed = EMPLOYEE_LIST_ROLES.includes(role)
  const isAdmin = canManageEmployees(role)

  const [showArchived, setShowArchived] = useState(false)
  const [notice, setNotice] = useState('')
  const [warning, setWarning] = useState('')
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
    setNotice(message)
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
    finish(`${created.name} was added.`, teamWarning)
  }

  async function handleEdit(payload, teamId) {
    const { employee } = dialog
    const updated = await api((token) => employeeService.updateEmployee(token, employee.id, payload))
    const teamWarning = await moveToTeam(updated, employee.team_id, teamId)
    finish(`${updated.name} was updated.`, teamWarning)
  }

  async function handleArchive() {
    const archived = await api((token) => employeeService.archiveEmployee(token, dialog.employee.id))
    finish(`${archived.name} was archived.`)
  }

  if (!allowed) {
    return (
      <AppShell>
        <PageHeader title="Employees" />
        <Alert severity="info">You don&apos;t have permission to view the employee list.</Alert>
      </AppShell>
    )
  }

  // Columns: email, job title and team move under the name on a phone.
  const columnCount = (isPhone ? 2 : 5) + (isAdmin ? 2 : 0)

  return (
    <AppShell>
      <PageHeader title="Employees"
        subtitle={isAdmin ? 'Everyone at ACME. Archive people instead of deleting them.' : 'The people in the teams you lead and across ACME.'}
        actions={isAdmin && (
          <>
            <FormControlLabel label="Show archived" control={
              <Switch checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            } />
            <Button variant="contained" onClick={() => setDialog({ kind: 'create' })}>
              Add employee
            </Button>
          </>
        )} />

      {notice && (
        <Alert severity="success" role="status" onClose={() => setNotice('')} sx={{ mb: 2 }}>
          {notice}
        </Alert>
      )}

      {warning && (
        <Alert severity="warning" onClose={() => setWarning('')} sx={{ mb: 2 }}>{warning}</Alert>
      )}

      <LoadState result={employees} label="Loading employees" skeleton="table">
        {(rows) => (
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
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={columnCount}>No employees to show.</TableCell>
                </TableRow>
              )}
              {rows.map((employee) => {
                const archived = Boolean(employee.archived_at)
                const isSelf = employee.id === user?.id
                return (
                  <TableRow key={employee.id} hover>
                    <TableCell component="th" scope="row">
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        {employee.name}
                        {archived && <Chip label="Archived" size="small" />}
                      </Box>
                      {isPhone && (
                        <Typography variant="body2" color="text.secondary">
                          {employee.job_title}
                          <br />
                          {teamName(employee.team_id, teams ?? [])}
                          <br />
                          {employee.email}
                        </Typography>
                      )}
                    </TableCell>
                    {!isPhone && <TableCell>{employee.email}</TableCell>}
                    {!isPhone && <TableCell>{employee.job_title}</TableCell>}
                    {!isPhone && <TableCell>{teamName(employee.team_id, teams ?? [])}</TableCell>}
                    <TableCell>{ROLE_LABELS[employee.role] ?? employee.role}</TableCell>
                    {isAdmin && <TableCell align="right">{money.format(employee.salary)}</TableCell>}
                    {isAdmin && (
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
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
