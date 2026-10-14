import { useCallback, useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
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
import { useAuth } from '../auth/useAuth'
import AppShell from '../components/AppShell'
import EmployeeFormDialog from '../components/EmployeeFormDialog'
import * as employeeService from '../services/employeeService'
import { withSessionRetry } from '../services/sessionRetry'
import { messageFor } from './employeeMessages'

const ROLE_LABELS = { admin: 'Admin', manager: 'Manager', employee: 'Employee' }
const money = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

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
  const { user, role, getAccessToken, refreshSession } = useAuth()
  const isPhone = useMediaQuery({ maxWidth: 599 })
  const allowed = EMPLOYEE_LIST_ROLES.includes(role)
  const isAdmin = canManageEmployees(role)

  const [employees, setEmployees] = useState([])
  const [loadState, setLoadState] = useState('loading') // 'loading' | 'ready' | 'error'
  const [loadError, setLoadError] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [notice, setNotice] = useState('')
  // null, { kind: 'create' }, { kind: 'edit', employee } or { kind: 'archive', employee }
  const [dialog, setDialog] = useState(null)

  const api = useCallback(
    (call) => withSessionRetry(call, { getAccessToken, refreshSession }),
    [getAccessToken, refreshSession],
  )

  useEffect(() => {
    if (!allowed) return undefined
    let cancelled = false
    api((token) => employeeService.listEmployees(token, { includeArchived: isAdmin && showArchived }))
      .then((rows) => {
        if (cancelled) return
        setEmployees(rows)
        setLoadState('ready')
      })
      .catch((error) => {
        if (cancelled) return
        setLoadError(messageFor(error))
        setLoadState('error')
      })
    return () => {
      cancelled = true
    }
  }, [allowed, api, isAdmin, showArchived, reloadKey])

  function finish(message) {
    setDialog(null)
    setNotice(message)
    setReloadKey((key) => key + 1)
  }

  async function handleCreate(payload) {
    const created = await api((token) => employeeService.createEmployee(token, payload))
    finish(`${created.name} was added.`)
  }

  async function handleEdit(payload) {
    const updated = await api((token) => employeeService.updateEmployee(token, dialog.employee.id, payload))
    finish(`${updated.name} was updated.`)
  }

  async function handleArchive() {
    const archived = await api((token) => employeeService.archiveEmployee(token, dialog.employee.id))
    finish(`${archived.name} was archived.`)
  }

  if (!allowed) {
    return (
      <AppShell>
        <Typography variant="h4" component="h1" gutterBottom>Employees</Typography>
        <Alert severity="info">You don&apos;t have permission to view the employee list.</Alert>
      </AppShell>
    )
  }

  // Columns: email and job title move under the name on a phone.
  const columnCount = (isPhone ? 2 : 4) + (isAdmin ? 2 : 0)

  return (
    <AppShell maxWidth="lg">
      <Box sx={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, mb: 2,
      }}>
        <Typography variant={isPhone ? 'h5' : 'h4'} component="h1" sx={{ flexGrow: 1 }}>
          Employees
        </Typography>
        {isAdmin && (
          <>
            <FormControlLabel label="Show archived" control={
              <Switch checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            } />
            <Button variant="contained" onClick={() => setDialog({ kind: 'create' })}>
              Add employee
            </Button>
          </>
        )}
      </Box>

      {notice && (
        <Alert severity="success" role="status" onClose={() => setNotice('')} sx={{ mb: 2 }}>
          {notice}
        </Alert>
      )}

      {loadState === 'loading' && (
        <Box role="status" aria-label="Loading employees" sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}
      {loadState === 'error' && <Alert severity="error">{loadError}</Alert>}

      {loadState === 'ready' && (
        <TableContainer component={Paper}>
          <Table aria-label="Employees" size={isPhone ? 'small' : 'medium'}>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                {!isPhone && <TableCell>Email</TableCell>}
                {!isPhone && <TableCell>Job title</TableCell>}
                <TableCell>Role</TableCell>
                {isAdmin && <TableCell align="right">Salary</TableCell>}
                {isAdmin && <TableCell align="right">Actions</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {employees.length === 0 && (
                <TableRow>
                  <TableCell colSpan={columnCount}>No employees to show.</TableCell>
                </TableRow>
              )}
              {employees.map((employee) => {
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
                          {employee.email}
                        </Typography>
                      )}
                    </TableCell>
                    {!isPhone && <TableCell>{employee.email}</TableCell>}
                    {!isPhone && <TableCell>{employee.job_title}</TableCell>}
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

      {dialog?.kind === 'create' && (
        <EmployeeFormDialog onClose={() => setDialog(null)} onSubmit={handleCreate} />
      )}
      {dialog?.kind === 'edit' && (
        <EmployeeFormDialog employee={dialog.employee} onClose={() => setDialog(null)}
          onSubmit={handleEdit} />
      )}
      {dialog?.kind === 'archive' && (
        <ArchiveDialog employee={dialog.employee} onClose={() => setDialog(null)}
          onConfirm={handleArchive} />
      )}
    </AppShell>
  )
}
