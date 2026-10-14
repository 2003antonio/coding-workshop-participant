import { useCallback, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import { useApi, useLoad } from '../auth/useApi'
import { detailsSentence, namesOf } from '../services/errorDetails'
import * as projectService from '../services/projectService'
import { messageFor } from '../pages/apiMessages'
import { DELIVERABLE_STATUS, formatDate } from '../pages/format'
import { DeliverableFormDialog, DependenciesDialog } from './DeliverableDialogs'
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
  const [dialog, setDialog] = useState(null) // null, { kind: 'add' } or { kind: 'deps', deliverable }
  const [saving, setSaving] = useState(null) // id of the deliverable whose status is being saved

  const load = useCallback(
    (call) => call((token) => projectService.listDeliverables(token, project.id)),
    [project.id],
  )
  const result = useLoad(load)
  const rows = result.data ?? []

  async function handleAdd(payload) {
    const created = await api((token) => projectService.createDeliverable(token, project.id, payload))
    setDialog(null)
    setNotice({ severity: 'success', text: `${created.name} was added.` })
    result.reload()
  }

  async function handleDependencies(dependsOn) {
    const updated = await api((token) =>
      projectService.setDependencies(token, project.id, dialog.deliverable.id, dependsOn))
    setDialog(null)
    setNotice({ severity: 'success', text: `Dependencies of ${updated.name} were saved.` })
    result.reload()
  }

  async function handleStatus(deliverable, status) {
    setNotice(null)
    setSaving(deliverable.id)
    try {
      await api((token) => projectService.updateDeliverable(token, project.id, deliverable.id, { status }))
      setNotice({ severity: 'success', text: `${deliverable.name} is now ${DELIVERABLE_STATUS[status].toLowerCase()}.` })
      result.reload()
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
      <LoadState result={result} label="Loading deliverables">
        {() => (
          <ResponsiveTable label="Deliverables" rows={rows} empty="No deliverables yet." columns={[
            { key: 'name', label: 'Deliverable', primary: true, render: (d) => (
              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                {d.name}
                {d.overdue && <Chip size="small" color="error" label="Overdue" />}
                {d.blocked && <Chip size="small" color="warning" label="Blocked" />}
              </Box>
            ) },
            { key: 'dates', label: 'Dates', render: (d) => `${formatDate(d.start_date)} – ${formatDate(d.due_date)}` },
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
              <Button size="small" aria-label={`Edit dependencies of ${d.name}`}
                onClick={() => setDialog({ kind: 'deps', deliverable: d })}>
                Dependencies
              </Button>
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
    </Box>
  )
}
