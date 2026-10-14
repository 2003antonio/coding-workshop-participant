import { useState } from 'react'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import FormDialog from './FormDialog'

const MAX_NAME = 200

/**
 * Create a team or change its name and lead (admin). `leads` are the people who
 * may lead it: active managers and admins who are not members of this team.
 * onSubmit(payload) -> promise. Create: { name, lead_id }; edit: only what changed.
 */
export function TeamFormDialog({ team, leads, onClose, onSubmit }) {
  const isCreate = !team
  const [name, setName] = useState(team?.name ?? '')
  const [leadId, setLeadId] = useState(team?.lead?.id ?? '')
  const [errors, setErrors] = useState({})

  function validate() {
    const found = {}
    if (!name.trim()) found.name = 'Enter a team name.'
    else if (name.trim().length > MAX_NAME) found.name = `Use at most ${MAX_NAME} characters.`
    if (!leadId) found.lead = 'Choose a lead.'
    setErrors(found)
    if (Object.keys(found).length) return null
    if (isCreate) return { name: name.trim(), lead_id: leadId }
    const changes = {}
    if (name.trim() !== team.name) changes.name = name.trim()
    if (leadId !== team.lead?.id) changes.lead_id = leadId
    return changes
  }

  return (
    <FormDialog id="team-form-title" title={isCreate ? 'New team' : `Edit ${team.name}`}
      submitLabel={isCreate ? 'Create team' : 'Save changes'} onClose={onClose}
      validate={validate} onSubmit={onSubmit}>
      <TextField label="Team name" required autoFocus fullWidth value={name} sx={{ mt: 1 }}
        onChange={(e) => setName(e.target.value)} error={Boolean(errors.name)} helperText={errors.name || ' '} />
      <TextField select label="Lead" required fullWidth value={leadId} onChange={(e) => setLeadId(e.target.value)}
        error={Boolean(errors.lead)}
        helperText={errors.lead || 'The lead manages the team’s projects and is never a member of the team.'}>
        {leads.length === 0 && <MenuItem value="" disabled>No managers available</MenuItem>}
        {leads.map((person) => (
          <MenuItem key={person.id} value={person.id}>{person.name} ({person.job_title})</MenuItem>
        ))}
      </TextField>
    </FormDialog>
  )
}

/** Add one person to a team (admin). `candidates`: active people on no team, not the lead. */
export function AddMemberDialog({ team, candidates, onClose, onSubmit }) {
  const [employeeId, setEmployeeId] = useState('')
  const [error, setError] = useState('')

  function validate() {
    if (!employeeId) {
      setError('Choose a person.')
      return null
    }
    return employeeId
  }

  return (
    <FormDialog id="add-member-title" title={`Add a member to ${team.name}`} submitLabel="Add member"
      onClose={onClose} validate={validate} onSubmit={onSubmit}>
      <TextField select label="Person" required fullWidth value={employeeId} sx={{ mt: 1 }}
        onChange={(e) => setEmployeeId(e.target.value)} error={Boolean(error)}
        helperText={error || 'Only people who are not on a team are listed.'}>
        {candidates.length === 0 && <MenuItem value="" disabled>Everyone is already on a team</MenuItem>}
        {candidates.map((person) => (
          <MenuItem key={person.id} value={person.id}>{person.name} ({person.job_title})</MenuItem>
        ))}
      </TextField>
    </FormDialog>
  )
}
