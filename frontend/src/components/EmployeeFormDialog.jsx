import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import { useMediaQuery } from 'react-responsive'
import { messageFor } from '../pages/employeeMessages'

// Same limits as backend/employees/routes.py, so most mistakes are caught
// before a request is sent. The server still checks everything.
const MAX_TEXT = 200
const MIN_PASSWORD = 12
const MAX_SALARY = 9999999999.99
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const ROLE_OPTIONS = [
  { value: 'employee', label: 'Employee' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Admin' },
]

function initialValues(employee) {
  return {
    name: employee?.name ?? '',
    email: employee?.email ?? '',
    job_title: employee?.job_title ?? '',
    role: employee?.role ?? 'employee',
    salary: employee?.salary === undefined ? '' : String(employee.salary),
    password: '',
    team_id: employee?.team_id ?? '',
  }
}

function validate(values, isCreate) {
  const errors = {}
  const text = (field, label) => {
    const value = values[field].trim()
    if (!value) errors[field] = `Enter a ${label}.`
    else if (value.length > MAX_TEXT) errors[field] = `Use at most ${MAX_TEXT} characters.`
  }
  text('name', 'name')
  text('job_title', 'job title')
  if (isCreate && !EMAIL_RE.test(values.email.trim())) errors.email = 'Enter a valid email address.'

  const salary = values.salary.trim()
  const amount = Number(salary)
  if (salary === '' || !Number.isFinite(amount)) errors.salary = 'Enter a salary as a number.'
  else if (amount < 0 || amount > MAX_SALARY) errors.salary = 'Enter a salary from 0 to 9,999,999,999.99.'
  else if (!/^\d+(\.\d{1,2})?$/.test(salary)) errors.salary = 'Use at most two decimal places.'

  if (isCreate && values.password.length < MIN_PASSWORD) {
    errors.password = `Use at least ${MIN_PASSWORD} characters.`
  }
  return errors
}

/**
 * Create or edit one employee. onSubmit(payload, teamId) must return a promise;
 * if it rejects, the dialog stays open and shows a friendly message.
 *   create payload: { name, email, job_title, role, salary, password }
 *   edit payload:   { name, job_title, role, salary }
 *   teamId: the chosen team, or null for none. Team membership is not part of
 *   the employee record: the caller changes it through /api/teams/{id}/members.
 * `teams` are the active teams to offer; null if they could not be loaded.
 */
export default function EmployeeFormDialog({ employee, teams = null, onClose, onSubmit }) {
  const isCreate = !employee
  const isPhone = useMediaQuery({ maxWidth: 599 })
  const [values, setValues] = useState(() => initialValues(employee))
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const titleId = 'employee-form-title'
  const field = (name) => ({
    name,
    value: values[name],
    onChange: (event) => setValues((v) => ({ ...v, [name]: event.target.value })),
    error: Boolean(errors[name]),
    helperText: errors[name] || ' ',
    fullWidth: true,
  })

  async function handleSubmit(event) {
    event.preventDefault()
    const found = validate(values, isCreate)
    setErrors(found)
    if (Object.keys(found).length > 0) return

    const payload = {
      name: values.name.trim(),
      job_title: values.job_title.trim(),
      role: values.role,
      salary: Number(values.salary),
    }
    if (isCreate) {
      payload.email = values.email.trim()
      payload.password = values.password
    }
    setServerError('')
    setSubmitting(true)
    try {
      await onSubmit(payload, values.team_id || null)
    } catch (error) {
      setServerError(messageFor(error))
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onClose={submitting ? undefined : onClose} aria-labelledby={titleId}
      fullScreen={isPhone} fullWidth maxWidth="sm">
      <Box component="form" onSubmit={handleSubmit} noValidate>
        <DialogTitle id={titleId}>{isCreate ? 'Add employee' : `Edit ${employee.name}`}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1, pt: 1 }}>
          <TextField label="Name" autoFocus required {...field('name')} sx={{ mt: 1 }} />
          {isCreate && (
            <TextField label="Email" type="email" autoComplete="off" required {...field('email')} />
          )}
          <TextField label="Job title" required {...field('job_title')} />
          <TextField select label="Role" required {...field('role')}>
            {ROLE_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
            ))}
          </TextField>
          <TextField select label="Team" {...field('team_id')} disabled={teams === null}
            helperText={teams === null ? "Teams couldn't be loaded, so the team can't be changed now." : ' '}>
            <MenuItem value="">No team</MenuItem>
            {(teams ?? [])
              // A lead is never a member of the team they lead.
              .filter((team) => !employee || team.lead?.id !== employee.id)
              .map((team) => <MenuItem key={team.id} value={team.id}>{team.name}</MenuItem>)}
          </TextField>
          <TextField label="Salary" required {...field('salary')}
            slotProps={{ htmlInput: { inputMode: 'decimal' } }} />
          {isCreate && (
            <TextField label="Initial password" type="password" autoComplete="new-password"
              required {...field('password')} />
          )}
          {serverError && <Alert severity="error">{serverError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={submitting}>
            {isCreate ? 'Add employee' : 'Save changes'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
