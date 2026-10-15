import { useCallback, useState } from 'react'
import Button from '@mui/material/Button'
import { useApi, useLoad } from '../auth/useApi'
import { messageFor } from '../pages/apiMessages'
import * as projectService from '../services/projectService'
import ConfirmDialog from './ConfirmDialog'
import { useProjectRefresh } from './projectRefresh'
import { useToast } from './toast/toast'

/** The project's terminal status (contract §4): "Completed". Reopening sets it back to active. */
const CLOSED_STATUS = 'completed'

/** Closable: at least one deliverable, and every non-archived one is done. */
function allDone(deliverables) {
  const current = deliverables.filter((d) => !d.archived_at)
  return current.length > 0 && current.every((d) => d.status === 'done')
}

/**
 * "Close project" (only when every deliverable is done) or "Reopen project" (when closed),
 * next to Edit on the project page. The caller shows it only to people who may edit the
 * project (admin, or the team's manager) and never on an archived project. Closing sets the
 * existing terminal status; it does not archive anything.
 */
export default function CloseProjectButton({ project, onError }) {
  const api = useApi()
  const toast = useToast()
  const { refreshKey, refresh } = useProjectRefresh()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const closed = project.status === CLOSED_STATUS

  const load = useCallback(
    (call) => (closed ? Promise.resolve([]) : call((token) => projectService.listDeliverables(token, project.id))),
    [closed, project.id],
  )
  const deliverables = useLoad(load, refreshKey)

  async function setStatus(status, message) {
    await api((token) => projectService.updateProject(token, project.id, { status }))
    toast(message)
    refresh()
  }

  async function reopen() {
    setBusy(true)
    onError('')
    try {
      await setStatus('active', 'Project reopened')
    } catch (error) {
      onError(messageFor(error))
    } finally {
      setBusy(false)
    }
  }

  if (closed) {
    return <Button variant="outlined" onClick={reopen} disabled={busy}>Reopen project</Button>
  }
  if (deliverables.status !== 'ready' || !allDone(deliverables.data)) return null
  return (
    <>
      <Button variant="contained" color="success" onClick={() => setConfirming(true)}>Close project</Button>
      {confirming && (
        <ConfirmDialog title={`Close ${project.name}?`} confirmLabel="Close project" confirmColor="primary"
          description="It stays visible and can be reopened. Closing does not archive it."
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            await setStatus(CLOSED_STATUS, 'Project closed')
            setConfirming(false)
          }} />
      )}
    </>
  )
}
