import { useCallback, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { canSeeSalaries } from '../auth/roles'
import { useApi, useLoad } from '../auth/useApi'
import * as allocationService from '../services/allocationService'
import * as employeeService from '../services/employeeService'
import * as teamService from '../services/teamService'
import { formatDate, formatMoney } from '../pages/format'
import { messageFor } from '../pages/apiMessages'
import { detailsSentence } from '../services/errorDetails'
import ConfirmDialog from './ConfirmDialog'
import FormDialog from './FormDialog'
import InlineEditCell from './inline/InlineEditCell'
import { LoadState } from './PageState'
import { DateField } from './ProjectFormDialog'
import ResponsiveTable from './ResponsiveTable'

const HOURS_HELP = 'Whole hours, 1 to 40. A person can work at most 40 hours a week in total.'

/** The problems with an assignment's hours and dates, by field. */
function assignmentErrors(values, project) {
  const found = {}
  const hours = String(values.hours_per_week).trim()
  if (!/^\d+$/.test(hours) || Number(hours) < 1 || Number(hours) > 40) {
    found.hours_per_week = 'Enter whole hours from 1 to 40.'
  }
  const outside = (date) => date < project.start_date || date > project.end_date
  const range = `Pick a date from ${formatDate(project.start_date)} to ${formatDate(project.end_date)}.`
  if (!values.start_date) found.start_date = 'Choose a start date.'
  else if (outside(values.start_date)) found.start_date = range
  if (!values.end_date) found.end_date = 'Choose an end date.'
  else if (outside(values.end_date)) found.end_date = range
  else if (values.start_date && values.end_date < values.start_date) found.end_date = 'End on or after the start date.'
  return found
}

/** Text-field props for values[name], with its error shown under it. */
const fieldProps = (values, setValues, errors) => (name) => ({
  value: values[name],
  onChange: (event) => setValues((v) => ({ ...v, [name]: event.target.value })),
  error: Boolean(errors[name]),
  helperText: errors[name] || ' ',
  fullWidth: true,
})

/** Assign one person to this project. onSubmit({ employee_id, project_id, hours_per_week, start_date, end_date }). */
function AssignDialog({ project, people, onClose, onSubmit }) {
  const [values, setValues] = useState({
    employee_id: '', hours_per_week: '', start_date: project.start_date, end_date: project.end_date,
  })
  const [errors, setErrors] = useState({})
  const field = fieldProps(values, setValues, errors)
  const inProject = { min: project.start_date, max: project.end_date }

  function validate() {
    const found = {}
    if (!values.employee_id) found.employee_id = 'Choose a person.'
    Object.assign(found, assignmentErrors(values, project))
    setErrors(found)
    if (Object.keys(found).length) return null
    return { ...values, project_id: project.id, hours_per_week: Number(values.hours_per_week.trim()) }
  }

  return (
    <FormDialog id="assign-title" title={`Assign someone to ${project.name}`} submitLabel="Assign"
      onClose={onClose} validate={validate} onSubmit={onSubmit}>
      <TextField select label="Person" required {...field('employee_id')} sx={{ mt: 1 }}
        helperText={errors.employee_id || ' '}>
        {people.length === 0 && <MenuItem value="" disabled>No one can be assigned</MenuItem>}
        {people.map((p) => <MenuItem key={p.id} value={p.id}>{p.name} ({p.job_title})</MenuItem>)}
      </TextField>
      <TextField label="Hours per week" required {...field('hours_per_week')}
        helperText={errors.hours_per_week || HOURS_HELP}
        slotProps={{ htmlInput: { inputMode: 'numeric' } }} />
      <DateField label="Start date" {...field('start_date')} slotProps={{ inputLabel: { shrink: true }, htmlInput: inProject }} />
      <DateField label="End date" {...field('end_date')} slotProps={{ inputLabel: { shrink: true }, htmlInput: inProject }} />
    </FormDialog>
  )
}

/** Change one assignment's hours or dates. onSubmit(changes) gets only what changed. */
function EditAssignmentDialog({ project, allocation, onClose, onSubmit }) {
  const [values, setValues] = useState({
    hours_per_week: String(allocation.hours_per_week),
    start_date: allocation.start_date,
    end_date: allocation.end_date,
  })
  const [errors, setErrors] = useState({})
  const field = fieldProps(values, setValues, errors)
  const inProject = { min: project.start_date, max: project.end_date }

  function validate() {
    const found = assignmentErrors(values, project)
    setErrors(found)
    if (Object.keys(found).length) return null
    const next = { ...values, hours_per_week: Number(values.hours_per_week.trim()) }
    return Object.fromEntries(Object.entries(next).filter(([key, value]) => value !== allocation[key]))
  }

  return (
    <FormDialog id="edit-assignment-title" title={`Edit assignment of ${allocation.employee.name}`}
      submitLabel="Save changes" onClose={onClose} validate={validate} onSubmit={onSubmit}>
      <TextField label="Hours per week" required autoFocus {...field('hours_per_week')} sx={{ mt: 1 }}
        helperText={errors.hours_per_week || HOURS_HELP}
        slotProps={{ htmlInput: { inputMode: 'numeric' } }} />
      <DateField label="Start date" {...field('start_date')} slotProps={{ inputLabel: { shrink: true }, htmlInput: inProject }} />
      <DateField label="End date" {...field('end_date')} slotProps={{ inputLabel: { shrink: true }, htmlInput: inProject }} />
    </FormDialog>
  )
}

/**
 * Who works on this project and for how many hours a week. The manager and
 * admins assign and remove people. Only admins see the weekly cost column.
 */
export default function AllocationsSection({ project, canEdit, role }) {
  const api = useApi()
  const showCost = canSeeSalaries(role)
  const [notice, setNotice] = useState('')
  const [problem, setProblem] = useState('') // why an in-place change was undone
  const [dialog, setDialog] = useState(null) // null, { kind: 'assign' } or { kind: 'edit' | 'remove', allocation }

  const load = useCallback(
    (call) => call((token) => allocationService.listAllocations(token, { projectId: project.id })),
    [project.id],
  )
  const result = useLoad(load)

  // Who can be assigned: admin anyone active; a manager only members of the project's team.
  const loadPeople = useCallback((call) => {
    if (!canEdit) return Promise.resolve([])
    if (role === 'admin') {
      return call((token) => employeeService.listEmployees(token)).then((rows) => rows.filter((e) => !e.archived_at))
    }
    return call((token) => teamService.getTeam(token, project.team.id)).then((team) => team.members ?? [])
  }, [canEdit, role, project.team.id])
  const people = useLoad(loadPeople)

  async function handleAssign(payload) {
    const created = await api((token) => allocationService.createAllocation(token, payload))
    setDialog(null)
    setNotice(`${created.employee.name} was assigned.`)
    result.reload()
  }

  async function handleEdit(changes) {
    const { allocation } = dialog
    if (Object.keys(changes).length === 0) {
      setDialog(null)
      return
    }
    await api((token) => allocationService.updateAllocation(token, allocation.id, changes))
    setDialog(null)
    setNotice(`${allocation.employee.name}'s assignment was updated.`)
    result.reload()
  }

  /** Hours changed in place. On a refusal the cell rolls back and this says why (with the weeks over 40 h). */
  async function saveHours(allocation, hours) {
    setNotice('')
    setProblem('')
    try {
      await api((token) => allocationService.updateAllocation(token, allocation.id, { hours_per_week: hours }))
      setNotice(`${allocation.employee.name}'s assignment was updated.`)
      result.reload()
    } catch (error) {
      const details = detailsSentence(error)
      setProblem(`${allocation.employee.name}: ${messageFor(error)}${details ? ` ${details}.` : ''} The change was undone.`)
      throw error
    }
  }

  async function handleRemove() {
    const { allocation } = dialog
    await api((token) => allocationService.archiveAllocation(token, allocation.id))
    setDialog(null)
    setNotice(`${allocation.employee.name} was removed from this project.`)
    result.reload()
  }

  const closed = Boolean(project.archived_at) || project.status === 'completed'

  return (
    <Box>
      {canEdit && !closed && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
          <Button variant="contained" onClick={() => setDialog({ kind: 'assign' })} disabled={people.status !== 'ready'}>
            Assign person
          </Button>
        </Box>
      )}
      {role === 'employee' && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          You can see only your own assignments.
        </Typography>
      )}
      {notice && <Alert severity="success" role="status" onClose={() => setNotice('')} sx={{ mb: 2 }}>{notice}</Alert>}
      {problem && <Alert severity="error" role="alert" onClose={() => setProblem('')} sx={{ mb: 2 }}>{problem}</Alert>}
      {people.status === 'error' && <Alert severity="warning" sx={{ mb: 2 }}>{people.error}</Alert>}
      <LoadState result={result} label="Loading assignments" skeleton="table">
        {(rows) => (
          <ResponsiveTable label="Assignments" rows={rows} empty="No one is assigned yet." columns={[
            { key: 'person', label: 'Person', primary: true, render: (a) => a.employee.name },
            { key: 'hours', label: 'Hours per week', align: 'right', render: (a) => (
              <InlineEditCell canEdit={canEdit && !closed} value={String(a.hours_per_week)}
                what={`hours per week of ${a.employee.name}`} inputProps={{ inputMode: 'numeric' }}
                validate={(hours) => assignmentErrors({ ...a, hours_per_week: hours }, project).hours_per_week ?? null}
                onSave={(hours) => saveHours(a, Number(hours))} />
            ) },
            { key: 'dates', label: 'Dates', render: (a) => `${formatDate(a.start_date)} – ${formatDate(a.end_date)}` },
            { key: 'cost', label: 'Weekly cost', align: 'right', hidden: !showCost,
              render: (a) => (a.weekly_cost === undefined ? '—' : formatMoney(a.weekly_cost)) },
            { key: 'actions', label: 'Actions', align: 'right', hidden: !canEdit || closed, render: (a) => (
              <Box component="span" sx={{ display: 'inline-flex', flexWrap: 'wrap', gap: 0.5, justifyContent: 'flex-end' }}>
                <Button size="small" aria-label={`Edit assignment of ${a.employee.name}`} sx={{ minHeight: 44 }}
                  onClick={() => setDialog({ kind: 'edit', allocation: a })}>
                  Edit
                </Button>
                <Button size="small" color="error" aria-label={`Remove ${a.employee.name}`} sx={{ minHeight: 44 }}
                  onClick={() => setDialog({ kind: 'remove', allocation: a })}>
                  Remove
                </Button>
              </Box>
            ) },
          ]} />
        )}
      </LoadState>
      {dialog?.kind === 'assign' && (
        <AssignDialog project={project} people={people.data} onClose={() => setDialog(null)} onSubmit={handleAssign} />
      )}
      {dialog?.kind === 'edit' && (
        <EditAssignmentDialog project={project} allocation={dialog.allocation} onClose={() => setDialog(null)}
          onSubmit={handleEdit} />
      )}
      {dialog?.kind === 'remove' && (
        <ConfirmDialog title={`Remove ${dialog.allocation.employee.name} from ${project.name}?`}
          description="The assignment is archived, not deleted. Their hours on this project stop counting."
          confirmLabel="Remove" onClose={() => setDialog(null)} onConfirm={handleRemove} />
      )}
    </Box>
  )
}
