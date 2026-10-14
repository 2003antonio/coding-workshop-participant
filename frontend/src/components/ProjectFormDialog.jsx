import { useState } from 'react'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import { PROJECT_STATUS } from '../pages/format'
import FormDialog from './FormDialog'

const MAX_NAME = 200
const MAX_DESCRIPTION = 2000

/** Shared date field: a native date picker with its label always above. */
export function DateField(props) {
  return <TextField type="date" fullWidth required slotProps={{ inputLabel: { shrink: true } }} {...props} />
}

/**
 * Create a project (admin; a manager for teams they lead). `teams` are the
 * teams the caller may pick. onSubmit({ team_id, name, description, status, start_date, end_date }).
 */
export default function ProjectFormDialog({ teams, onClose, onSubmit }) {
  const [values, setValues] = useState({
    team_id: teams.length === 1 ? teams[0].id : '', name: '', description: '', status: 'planned',
    start_date: '', end_date: '',
  })
  const [errors, setErrors] = useState({})
  const field = (name) => ({
    value: values[name],
    onChange: (event) => setValues((v) => ({ ...v, [name]: event.target.value })),
    error: Boolean(errors[name]),
    helperText: errors[name] || ' ',
    fullWidth: true,
  })

  function validate() {
    const found = {}
    if (!values.team_id) found.team_id = 'Choose a team.'
    if (!values.name.trim()) found.name = 'Enter a project name.'
    else if (values.name.trim().length > MAX_NAME) found.name = `Use at most ${MAX_NAME} characters.`
    if (values.description.trim().length > MAX_DESCRIPTION) {
      found.description = `Use at most ${MAX_DESCRIPTION} characters.`
    }
    if (!values.start_date) found.start_date = 'Choose a start date.'
    if (!values.end_date) found.end_date = 'Choose an end date.'
    else if (values.start_date && values.end_date < values.start_date) found.end_date = 'End on or after the start date.'
    setErrors(found)
    if (Object.keys(found).length) return null
    return { ...values, name: values.name.trim(), description: values.description.trim() }
  }

  return (
    <FormDialog id="project-form-title" title="New project" submitLabel="Create project" onClose={onClose}
      validate={validate} onSubmit={onSubmit}>
      <TextField select label="Team" required {...field('team_id')} sx={{ mt: 1 }}>
        {teams.map((team) => <MenuItem key={team.id} value={team.id}>{team.name}</MenuItem>)}
      </TextField>
      <TextField label="Project name" required {...field('name')} />
      <TextField label="Description" multiline minRows={2} {...field('description')} />
      <TextField select label="Status" {...field('status')}>
        {Object.entries(PROJECT_STATUS).map(([value, label]) => (
          <MenuItem key={value} value={value}>{label}</MenuItem>
        ))}
      </TextField>
      <DateField label="Start date" {...field('start_date')} />
      <DateField label="End date" {...field('end_date')} />
    </FormDialog>
  )
}
