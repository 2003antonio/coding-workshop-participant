import { useState } from 'react'
import Checkbox from '@mui/material/Checkbox'
import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormGroup from '@mui/material/FormGroup'
import FormHelperText from '@mui/material/FormHelperText'
import FormLabel from '@mui/material/FormLabel'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import { DELIVERABLE_STATUS, formatDate } from '../pages/format'
import FormDialog from './FormDialog'
import { defaultStartDate } from './deliverableDates'
import { DateField } from './ProjectFormDialog'

export const MAX_NAME = 200
const MAX_DESCRIPTION = 2000
const MAX_DEPENDENCIES = 50

/** A checkbox list of the deliverables this one may depend on. */
function DependencyPicker({ options, selected, onChange, error }) {
  const toggle = (id) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
  return (
    <FormControl component="fieldset" error={Boolean(error)}>
      <FormLabel component="legend">Depends on</FormLabel>
      {options.length === 0 ? (
        <FormHelperText>There are no other deliverables in this project yet.</FormHelperText>
      ) : (
        <FormGroup>
          {options.map((d) => (
            <FormControlLabel key={d.id} label={`${d.name} (due ${formatDate(d.due_date)})`} control={
              <Checkbox checked={selected.includes(d.id)} onChange={() => toggle(d.id)} />
            } />
          ))}
        </FormGroup>
      )}
      <FormHelperText>{error || 'It cannot start until these are done.'}</FormHelperText>
    </FormControl>
  )
}

/** The problems with a deliverable's name, description and dates, by field. */
function deliverableErrors(values, project) {
  const found = {}
  if (!values.name.trim()) found.name = 'Enter a name.'
  else if (values.name.trim().length > MAX_NAME) found.name = `Use at most ${MAX_NAME} characters.`
  if (values.description.trim().length > MAX_DESCRIPTION) {
    found.description = `Use at most ${MAX_DESCRIPTION} characters.`
  }
  const outside = (date) => date < project.start_date || date > project.end_date
  const range = `Pick a date from ${formatDate(project.start_date)} to ${formatDate(project.end_date)}.`
  if (!values.start_date) found.start_date = 'Choose a start date.'
  else if (outside(values.start_date)) found.start_date = range
  if (!values.due_date) found.due_date = 'Choose a due date.'
  else if (outside(values.due_date)) found.due_date = range
  else if (values.start_date && values.due_date < values.start_date) {
    found.due_date = 'The due date can’t be before the start date. Pick the start date or a later day.'
  }
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

/**
 * Add a deliverable. Dates must sit inside the project's dates; both start on
 * defaultStartDate() (due = start), so the due date is never before the start.
 * onSubmit({ name, description, start_date, due_date, depends_on }).
 */
export function DeliverableFormDialog({ project, deliverables, onClose, onSubmit }) {
  const [values, setValues] = useState(() => {
    const start = defaultStartDate(project)
    return { name: '', description: '', start_date: start, due_date: start }
  })
  const [dependsOn, setDependsOn] = useState([])
  const [errors, setErrors] = useState({})
  const field = fieldProps(values, setValues, errors)
  const inProject = { min: project.start_date, max: project.end_date }

  function validate() {
    const found = deliverableErrors(values, project)
    if (dependsOn.length > MAX_DEPENDENCIES) found.depends_on = `Pick at most ${MAX_DEPENDENCIES}.`
    setErrors(found)
    if (Object.keys(found).length) return null
    return { ...values, name: values.name.trim(), description: values.description.trim(), depends_on: dependsOn }
  }

  return (
    <FormDialog id="deliverable-form-title" title="Add deliverable" submitLabel="Add deliverable" onClose={onClose}
      validate={validate} onSubmit={onSubmit} errorContext={{ deliverables }}>
      <TextField label="Name" required autoFocus {...field('name')} sx={{ mt: 1 }} />
      <TextField label="Description" multiline minRows={2} {...field('description')} />
      <DateField label="Start date" {...field('start_date')} slotProps={{ inputLabel: { shrink: true }, htmlInput: inProject }} />
      <DateField label="Due date" {...field('due_date')} slotProps={{ inputLabel: { shrink: true }, htmlInput: inProject }} />
      <DependencyPicker options={deliverables} selected={dependsOn} onChange={setDependsOn} error={errors.depends_on} />
    </FormDialog>
  )
}

/**
 * Change a deliverable's name, description, dates or status. Dependencies have
 * their own dialog. onSubmit(changes) gets only the fields that changed.
 */
export function DeliverableEditDialog({ project, deliverable, deliverables, onClose, onSubmit }) {
  const [values, setValues] = useState({
    name: deliverable.name,
    description: deliverable.description ?? '',
    start_date: deliverable.start_date,
    due_date: deliverable.due_date,
    status: deliverable.status,
  })
  const [errors, setErrors] = useState({})
  const field = fieldProps(values, setValues, errors)
  const inProject = { min: project.start_date, max: project.end_date }

  function validate() {
    const found = deliverableErrors(values, project)
    setErrors(found)
    if (Object.keys(found).length) return null
    const next = { ...values, name: values.name.trim(), description: values.description.trim() }
    const changes = {}
    for (const key of Object.keys(next)) {
      if (next[key] !== (deliverable[key] ?? '')) changes[key] = next[key]
    }
    return changes
  }

  return (
    <FormDialog id="deliverable-edit-title" title={`Edit ${deliverable.name}`} submitLabel="Save changes"
      onClose={onClose} validate={validate} onSubmit={onSubmit} errorContext={{ deliverables }}>
      <TextField label="Name" required autoFocus {...field('name')} sx={{ mt: 1 }} />
      <TextField label="Description" multiline minRows={2} {...field('description')} />
      <DateField label="Start date" {...field('start_date')} slotProps={{ inputLabel: { shrink: true }, htmlInput: inProject }} />
      <DateField label="Due date" {...field('due_date')} slotProps={{ inputLabel: { shrink: true }, htmlInput: inProject }} />
      <TextField select label="Status" {...field('status')}
        helperText="It can only start once everything it depends on is done.">
        {Object.entries(DELIVERABLE_STATUS).map(([value, label]) => (
          <MenuItem key={value} value={value}>{label}</MenuItem>
        ))}
      </TextField>
    </FormDialog>
  )
}

/** Replace the whole set of dependencies of one deliverable. onSubmit([ids]). */
export function DependenciesDialog({ deliverable, deliverables, onClose, onSubmit }) {
  const [dependsOn, setDependsOn] = useState(deliverable.depends_on)
  const [error, setError] = useState('')
  const options = deliverables.filter((d) => d.id !== deliverable.id)

  function validate() {
    if (dependsOn.length > MAX_DEPENDENCIES) {
      setError(`Pick at most ${MAX_DEPENDENCIES}.`)
      return null
    }
    return dependsOn
  }

  return (
    <FormDialog id="dependencies-title" title={`Dependencies of ${deliverable.name}`} submitLabel="Save dependencies"
      onClose={onClose} validate={validate} onSubmit={onSubmit} errorContext={{ deliverables }}>
      <DependencyPicker options={options} selected={dependsOn} onChange={setDependsOn} error={error} />
    </FormDialog>
  )
}
