import { useCallback, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import { useApi, useLoad } from '../auth/useApi'
import { useProjectRefresh } from './projectRefresh'
import { detailsSentence, namesOf } from '../services/errorDetails'
import * as projectService from '../services/projectService'
import { ARCHIVE_NOTE, messageFor } from '../pages/apiMessages'
import { DELIVERABLE_STATUS, formatDate } from '../pages/format'
import ConfirmDialog from './ConfirmDialog'
import { DeliverableEditDialog, DeliverableFormDialog, DependenciesDialog, MAX_NAME } from './DeliverableDialogs'
import InlineEditCell from './inline/InlineEditCell'
import { LoadState } from './PageState'
import ResponsiveTable from './ResponsiveTable'
import StatusChip from './StatusChip'

/**
 * The project's deliverables with dates, status and dependencies. The project's
 * manager and admins add deliverables, change status and edit dependencies;
 * everyone else reads.
 */
export default function DeliverablesSection({ project, canEdit }) {
  const api = useApi()
  const [notice, setNotice] = useState(null) // { severity, text }
  // null, { kind: 'add' }, or { kind: 'deps' | 'edit' | 'archive', deliverable }
  const [dialog, setDialog] = useState(null)
  const [saving, setSaving] = useState(null) // id of the deliverable whose status is being saved

  const load = useCallback(
    (call) => call((token) => projectService.listDeliverables(token, project.id)),
    [project.id],
  )
  const { refreshKey, refresh } = useProjectRefresh()
  const result = useLoad(load, refreshKey)
  // After a change: reload this list, and refresh the rest of the project page (header budget, health strip).
  const changed = () => {
    result.reload()
    refresh()
  }
  const rows = result.data ?? []

  async function handleAdd(payload) {
    const created = await api((token) => projectService.createDeliverable(token, project.id, payload))
    setDialog(null)
    setNotice({ severity: 'success', text: `${created.name} was added.` })
    changed()
  }

  async function handleDependencies(dependsOn) {
    const updated = await api((token) =>
      projectService.setDependencies(token, project.id, dialog.deliverable.id, dependsOn))
    setDialog(null)
    setNotice({ severity: 'success', text: `Dependencies of ${updated.name} were saved.` })
    changed()
  }

  async function handleEdit(changes) {
    const { deliverable } = dialog
    if (Object.keys(changes).length === 0) {
      setDialog(null)
      return
    }
    const updated = await api((token) => projectService.updateDeliverable(token, project.id, deliverable.id, changes))
    setDialog(null)
    setNotice({ severity: 'success', text: `${updated.name} was updated.` })
    changed()
  }

  async function handleArchive() {
    const { deliverable } = dialog
    await api((token) => projectService.archiveDeliverable(token, project.id, deliverable.id))
    setDialog(null)
    setNotice({ severity: 'success', text: `${deliverable.name} was archived.` })
    changed()
  }

  /** Save one field changed in place. On a refusal the cell rolls back and this says why. */
  async function saveInline(deliverable, changes) {
    setNotice(null)
    try {
      const updated = await api((token) => projectService.updateDeliverable(token, project.id, deliverable.id, changes))
      setNotice({ severity: 'success', text: `${updated.name} was updated.` })
      changed()
    } catch (error) {
      const details = detailsSentence(error, { deliverables: rows })
      setNotice({
        severity: 'error',
        text: `${deliverable.name}: ${messageFor(error)}${details ? ` ${details}.` : ''} The change was undone.`,
      })
      throw error
    }
  }

  const checkName = (name) => {
    if (!name) return 'Enter a name.'
    return name.length > MAX_NAME ? `Use at most ${MAX_NAME} characters.` : null
  }
  const checkDue = (d) => (due) => {
    if (!due) return 'Choose a due date.'
    if (due < project.start_date || due > project.end_date) {
      return `Pick a date from ${formatDate(project.start_date)} to ${formatDate(project.end_date)}.`
    }
    return due < d.start_date ? 'The due date can’t be before the start date. Pick the start date or a later day.' : null
  }

  async function handleStatus(deliverable, status) {
    setNotice(null)
    setSaving(deliverable.id)
    try {
      await api((token) => projectService.updateDeliverable(token, project.id, deliverable.id, { status }))
      setNotice({ severity: 'success', text: `${deliverable.name} is now ${DELIVERABLE_STATUS[status].toLowerCase()}.` })
      changed()
    } catch (error) {
      const details = detailsSentence(error, { deliverables: rows })
      setNotice({
        severity: 'error',
        text: `${deliverable.name}: ${messageFor(error)}${details ? ` ${details}.` : ''}`,
      })
    } finally {
      setSaving(null)
    }
  }

  return (
    <Box>
      {canEdit && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
          <Button variant="contained" onClick={() => setDialog({ kind: 'add' })} disabled={result.status !== 'ready'}>
            Add deliverable
          </Button>
        </Box>
      )}
      {notice && (
        <Alert severity={notice.severity} role={notice.severity === 'error' ? 'alert' : 'status'}
          onClose={() => setNotice(null)} sx={{ mb: 2 }}>
          {notice.text}
        </Alert>
      )}
      <LoadState result={result} label="Loading deliverables" skeleton="table">
        {() => (
          <ResponsiveTable label="Deliverables" rows={rows} empty="No deliverables yet." columns={[
            { key: 'name', label: 'Deliverable', primary: true, render: (d) => (
              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <InlineEditCell canEdit={canEdit} value={d.name} what={`name of ${d.name}`}
                  validate={checkName} onSave={(name) => saveInline(d, { name })} />
                {d.overdue && <Chip size="small" color="error" label="Overdue" />}
                {d.blocked && <Chip size="small" color="warning" label="Blocked" />}
              </Box>
            ) },
            { key: 'dates', label: 'Dates', render: (d) => (
              <InlineEditCell canEdit={canEdit} value={d.due_date} type="date" what={`due date of ${d.name}`}
                format={(due) => `${formatDate(d.start_date)} – ${formatDate(due)}`}
                inputProps={{ min: d.start_date, max: project.end_date }}
                validate={checkDue(d)} onSave={(due_date) => saveInline(d, { due_date })} />
            ) },
            { key: 'status', label: 'Status', render: (d) => (canEdit ? (
              <TextField select size="small" value={d.status} disabled={saving === d.id}
                onChange={(e) => handleStatus(d, e.target.value)}
                slotProps={{ select: { SelectDisplayProps: { 'aria-label': `Status of ${d.name}` } } }}>
                {Object.entries(DELIVERABLE_STATUS).map(([value, label]) => (
                  <MenuItem key={value} value={value}>{label}</MenuItem>
                ))}
              </TextField>
            ) : <StatusChip status={d.status} />) },
            { key: 'deps', label: 'Depends on', render: (d) => (
              d.depends_on.length ? namesOf(d.depends_on, rows).join(', ') : '—'
            ) },
            { key: 'actions', label: 'Actions', align: 'right', hidden: !canEdit, render: (d) => (
              <Box component="span" sx={{ display: 'inline-flex', flexWrap: 'wrap', gap: 0.5, justifyContent: 'flex-end' }}>
                <Button size="small" aria-label={`Edit ${d.name}`} sx={{ minHeight: 44 }}
                  onClick={() => setDialog({ kind: 'edit', deliverable: d })}>
                  Edit
                </Button>
                <Button size="small" aria-label={`Edit dependencies of ${d.name}`} sx={{ minHeight: 44 }}
                  onClick={() => setDialog({ kind: 'deps', deliverable: d })}>
                  Dependencies
                </Button>
                <Button size="small" color="error" aria-label={`Archive ${d.name}`} sx={{ minHeight: 44 }}
                  onClick={() => setDialog({ kind: 'archive', deliverable: d })}>
                  Archive
                </Button>
              </Box>
            ) },
          ]} />
        )}
      </LoadState>
      {dialog?.kind === 'add' && (
        <DeliverableFormDialog project={project} deliverables={rows} onClose={() => setDialog(null)}
          onSubmit={handleAdd} />
      )}
      {dialog?.kind === 'deps' && (
        <DependenciesDialog deliverable={dialog.deliverable} deliverables={rows} onClose={() => setDialog(null)}
          onSubmit={handleDependencies} />
      )}
      {dialog?.kind === 'edit' && (
        <DeliverableEditDialog project={project} deliverable={dialog.deliverable} deliverables={rows}
          onClose={() => setDialog(null)} onSubmit={handleEdit} />
      )}
      {dialog?.kind === 'archive' && (
        <ConfirmDialog title={`Archive ${dialog.deliverable.name}?`}
          description={ARCHIVE_NOTE} confirmLabel="Archive"
          onClose={() => setDialog(null)} onConfirm={handleArchive} />
      )}
    </Box>
  )
}
