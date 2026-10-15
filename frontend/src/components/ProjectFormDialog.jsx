import { useState } from 'react'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import { PROJECT_STATUS } from '../pages/format'
import FormDialog from './FormDialog'
import { datesConflicts } from './projectDates'

const MAX_NAME = 200
const MAX_DESCRIPTION = 2000
const MAX_BUDGET = 9999999999.99

/** Shared date field: a native date picker with its label always above. */
export function DateField(props) {
  return <TextField type="date" fullWidth required slotProps={{ inputLabel: { shrink: true } }} {...props} />
}

/** "" -> null (no budget), "52000.5" -> 52000.5, or an error message. */
function parseBudget(text) {
  const value = text.trim().replace(/,/g, '')
  if (value === '') return { amount: null }
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return { error: 'Enter an amount like 52000 or 52000.50.' }
  const amount = Number(value)
  if (amount > MAX_BUDGET) return { error: 'Enter an amount up to 9,999,999,999.99.' }
  return { amount }
}

/**
 * Create a project (admin; a manager for teams they lead), or edit one (admin;
 * the project's manager). Only these people ever open it, so the optional
 * planned budget is always offered here.
 *   teams: the teams the caller may pick; canChangeTeam: false keeps the team fixed
 *   create: onSubmit({ team_id, name, description, status, start_date, end_date, planned_budget? })
 *   edit:   onSubmit({ ...only the changed fields })
 *   contents (edit): { deliverables, allocations } already loaded; changed dates that would leave
 *   one of them outside are refused here with a sentence naming up to 3 (the server checks too).
 */
export default function ProjectFormDialog({ project, teams, canChangeTeam = true, contents, onClose, onSubmit }) {
  const isCreate = !project
  const [values, setValues] = useState(() => ({
    team_id: project?.team.id ?? (teams.length === 1 ? teams[0].id : ''),
    name: project?.name ?? '',
    description: project?.description ?? '',
    status: project?.status ?? 'planned',
    start_date: project?.start_date ?? '',
    end_date: project?.end_date ?? '',
    planned_budget: project?.planned_budget === null || project?.planned_budget === undefined
      ? '' : String(project.planned_budget),
  }))
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
    const datesChanged = !isCreate && (values.start_date !== project.start_date || values.end_date !== project.end_date)
    if (datesChanged && contents && !found.start_date && !found.end_date) {
      const clash = datesConflicts(values.start_date, values.end_date, contents.deliverables, contents.allocations)
      if (clash.start) found.start_date = clash.start
      if (clash.end) found.end_date = clash.end
    }
    const budget = parseBudget(values.planned_budget)
    if (budget.error) found.planned_budget = budget.error
    setErrors(found)
    if (Object.keys(found).length) return null

    const payload = {
      team_id: values.team_id, name: values.name.trim(), description: values.description.trim(),
      status: values.status, start_date: values.start_date, end_date: values.end_date,
    }
    if (isCreate) return budget.amount === null ? payload : { ...payload, planned_budget: budget.amount }
    const changes = {}
    for (const [key, value] of Object.entries(payload)) {
      const before = key === 'team_id' ? project.team.id : project[key]
      if (value !== before && (key !== 'team_id' || canChangeTeam)) changes[key] = value
    }
    if (budget.amount !== (project.planned_budget ?? null)) changes.planned_budget = budget.amount
    return changes
  }

  return (
    <FormDialog id="project-form-title" title={isCreate ? 'New project' : `Edit ${project.name}`}
      submitLabel={isCreate ? 'Create project' : 'Save changes'} onClose={onClose}
      validate={validate} onSubmit={onSubmit}>
      <TextField select label="Team" required {...field('team_id')} sx={{ mt: 1 }} disabled={!canChangeTeam}
        helperText={errors.team_id || (canChangeTeam ? ' ' : 'Only an admin can move a project to another team.')}>
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
      <TextField label="Planned budget (optional)" {...field('planned_budget')}
        helperText={errors.planned_budget || 'The amount you plan to spend. Leave empty if there is none.'}
        slotProps={{ htmlInput: { inputMode: 'decimal' } }} />
    </FormDialog>
  )
}
