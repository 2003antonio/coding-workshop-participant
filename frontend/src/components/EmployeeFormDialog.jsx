import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormHelperText from '@mui/material/FormHelperText'
import InputAdornment from '@mui/material/InputAdornment'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useMediaQuery } from 'react-responsive'
import { EMAIL_DOMAIN } from '../config'
import { fullEmail, plainSalary, withSeparators } from './employeeFields'
import { messageFor } from '../pages/employeeMessages'
import { ledTeams } from '../pages/people'
import { RevealButton } from './MaskedMoney'
import { MASK, useReveal } from './reveal'
import { generatePassword } from './tempPassword'
import { useToast } from './toast/toast'

// Same limits as backend/employees/routes.py, so most mistakes are caught
// before a request is sent. The server still checks everything.
const MAX_TEXT = 200
const MIN_PASSWORD = 12 // tempPassword.js makes 16
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
    salary: employee?.salary === undefined ? '' : withSeparators(String(employee.salary)),
    password: '',
    team_id: employee?.team_id ?? '',
  }
}

function validate(values, isCreate, checkSalary = true) {
  const errors = {}
  const text = (field, label) => {
    const value = values[field].trim()
    if (!value) errors[field] = `Enter a ${label}.`
    else if (value.length > MAX_TEXT) errors[field] = `Use at most ${MAX_TEXT} characters.`
  }
  text('name', 'name')
  text('job_title', 'job title')
  if (isCreate && (!values.email.trim() || !EMAIL_RE.test(fullEmail(values.email)))) {
    errors.email = 'Enter a valid email address.'
  }

  const salary = plainSalary(values.salary)
  const amount = Number(salary)
  if (!checkSalary) {
    // Editing without touching the salary: it is not sent, so there is nothing to check.
  } else if (salary === '' || !Number.isFinite(amount)) errors.salary = 'Enter a salary as a number.'
  else if (amount < 0 || amount > MAX_SALARY) errors.salary = 'Enter a salary from 0 to 9,999,999,999.99.'
  else if (!/^\d+(\.\d{1,2})?$/.test(salary)) errors.salary = 'Use at most two decimal places.'

  if (isCreate && !values.password) errors.password = 'Generate a temporary password first.'
  else if (isCreate && values.password.length < MIN_PASSWORD) errors.password = `Use at least ${MIN_PASSWORD} characters.`
  return errors
}

/**
 * Create or edit one employee. onSubmit(payload, teamId) must return a promise;
 * if it rejects, the dialog stays open and shows a friendly message.
 *   create payload: { name, email, job_title, role, salary, password }. The email is the part
 *                   before the @ plus EMAIL_DOMAIN unless a full address was typed; the password
 *                   is generated here (tempPassword.js), shown once and never typed
 *   edit payload:   { name, job_title, role, salary? } (salary only when it was changed;
 *                   it stays masked until the admin clicks "Show salary for <name>")
 *   teamId: the chosen team, or null for none. Team membership is not part of
 *   the employee record: the caller changes it through /api/teams/{id}/members.
 * `teams` are the active teams to offer; null if they could not be loaded.
 */
/** Under the Team field: why it can't change, or that a lead leads (and is not a member of) their team. */
function teamHelp(employee, teams) {
  if (teams === null) return "Teams couldn't be loaded, so the team can't be changed now."
  const led = employee ? ledTeams(employee.id, teams) : []
  if (led.length === 0) return ' '
  return `Leads ${led.map((t) => t.name).join(', ')}. A lead is not a member of the team they lead.`
}

export default function EmployeeFormDialog({ employee, teams = null, onClose, onSubmit }) {
  const isCreate = !employee
  const isPhone = useMediaQuery({ maxWidth: 599 })
  const toast = useToast()
  const [values, setValues] = useState(() => initialValues(employee))
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [copyProblem, setCopyProblem] = useState('')
  const [salaryShown, setSalaryShown] = useReveal()
  const salaryChanged = isCreate || plainSalary(values.salary) !== plainSalary(initialValues(employee).salary)
  const typedFullEmail = values.email.includes('@')

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
    const found = validate(values, isCreate, salaryChanged)
    setErrors(found)
    if (Object.keys(found).length > 0) return

    const payload = {
      name: values.name.trim(),
      job_title: values.job_title.trim(),
      role: values.role,
    }
    if (salaryChanged) payload.salary = Number(plainSalary(values.salary))
    if (isCreate) {
      payload.email = fullEmail(values.email)
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

  function newPassword() {
    setCopyProblem('')
    setValues((v) => ({ ...v, password: generatePassword() }))
    setErrors((e) => ({ ...e, password: undefined }))
  }

  async function copyPassword() {
    setCopyProblem('')
    try {
      await navigator.clipboard.writeText(values.password)
      toast('Password copied') // never the password itself
    } catch {
      setCopyProblem("Copying didn't work here. Select the password and copy it by hand.")
    }
  }

  const salaryField = (
    <TextField label="Salary (yearly)" required {...field('salary')}
      onBlur={() => setValues((v) => ({ ...v, salary: withSeparators(v.salary) }))}
      slotProps={{
        htmlInput: { inputMode: 'decimal' },
        input: { startAdornment: <InputAdornment position="start">$</InputAdornment> },
      }} />
  )

  return (
    <Dialog open onClose={submitting ? undefined : onClose} aria-labelledby={titleId}
      fullScreen={isPhone} fullWidth maxWidth="sm">
      <Box component="form" onSubmit={handleSubmit} noValidate>
        <DialogTitle id={titleId}>{isCreate ? 'Add employee' : `Edit ${employee.name}`}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1, pt: 1 }}>
          <TextField label="Name" autoFocus required {...field('name')} sx={{ mt: 1 }} />
          {isCreate && (
            <TextField label="Email" autoComplete="off" required {...field('email')}
              helperText={errors.email || (typedFullEmail ? ' ' : 'Type the part before the @.')}
              slotProps={{
                htmlInput: { autoCapitalize: 'none', spellCheck: false },
                input: typedFullEmail ? undefined : {
                  endAdornment: <InputAdornment position="end">@{EMAIL_DOMAIN}</InputAdornment>,
                },
              }} />
          )}
          <TextField label="Job title" required {...field('job_title')} />
          <TextField select label="Role" required {...field('role')}>
            {ROLE_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
            ))}
          </TextField>
          <TextField select label="Team" {...field('team_id')} disabled={teams === null}
            helperText={teamHelp(employee, teams)}>
            <MenuItem value="">No team</MenuItem>
            {(teams ?? [])
              // A lead is never a member of the team they lead.
              .filter((team) => !employee || team.lead?.id !== employee.id)
              .map((team) => <MenuItem key={team.id} value={team.id}>{team.name}</MenuItem>)}
          </TextField>
          {isCreate || salaryShown ? (
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
              {salaryField}
              {!isCreate && (
                <Box sx={{ pt: 1.5 }}>
                  <RevealButton shown onToggle={() => setSalaryShown(false)} what="salary" name={employee.name} />
                </Box>
              )}
            </Box>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 56, mb: 2.5 }}>
              <Typography color="text.secondary">Salary (yearly)</Typography>
              <Typography aria-label="salary hidden" sx={{ letterSpacing: 1 }}>{MASK}</Typography>
              <RevealButton shown={false} onToggle={() => setSalaryShown(true)} what="salary" name={employee.name} />
            </Box>
          )}
          {isCreate && !values.password && (
            <Box sx={{ mb: 1 }}>
              <Button variant="outlined" onClick={newPassword}>Generate temporary password</Button>
              <FormHelperText error={Boolean(errors.password)}>
                {errors.password || 'The person signs in with it the first time.'}
              </FormHelperText>
            </Box>
          )}
          {isCreate && values.password && (
            <Box sx={{ mb: 1 }}>
              <TextField label="Temporary password" value={values.password} fullWidth autoComplete="off"
                helperText="Share this with the person once; it will not be shown again."
                slotProps={{
                  htmlInput: { readOnly: true, spellCheck: false, style: { fontFamily: 'ui-monospace, Consolas, monospace', letterSpacing: 1 } },
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">
                        <Button size="small" onClick={copyPassword}>Copy</Button>
                      </InputAdornment>
                    ),
                  },
                }} />
              {copyProblem && <FormHelperText error>{copyProblem}</FormHelperText>}
              <Button size="small" onClick={newPassword} sx={{ mt: 0.5 }}>Generate another</Button>
            </Box>
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
