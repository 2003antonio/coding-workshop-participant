import { useId, useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import { messageFor } from '../pages/apiMessages'

/**
 * Ask before a change that is hard to undo (confirmColor 'error' by default; 'primary' for a safe one). onConfirm() returns a promise; if it
 * rejects, the dialog stays open with a friendly message (or the error's own `sentence`).
 * `children` go under the description (e.g. a checkbox).
 */
export default function ConfirmDialog({
  title, description, confirmLabel, confirmColor = 'error', onClose, onConfirm, children,
}) {
  const id = useId()
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleConfirm() {
    setError('')
    setSubmitting(true)
    try {
      await onConfirm()
    } catch (err) {
      setError(err?.sentence ?? messageFor(err))
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onClose={submitting ? undefined : onClose} aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}>
      <DialogTitle id={`${id}-title`}>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText id={`${id}-description`}>{description}</DialogContentText>
        {children}
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button color={confirmColor} variant="contained" onClick={handleConfirm} disabled={submitting}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
