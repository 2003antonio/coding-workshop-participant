import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import { useMediaQuery } from 'react-responsive'
import { messageFor } from '../pages/apiMessages'
import { detailsSentence } from '../services/errorDetails'

/**
 * A form in a dialog. On submit, validate() returns the payload (or null to stop);
 * onSubmit(payload) returns a promise. If it rejects, the dialog stays open with
 * a friendly message and, on its own line, the sentence for any structured 409
 * details (services/errorDetails.js). errorContext.deliverables turns ids into names.
 */
export default function FormDialog({
  id, title, submitLabel, onClose, validate, onSubmit, errorContext, children,
}) {
  const isPhone = useMediaQuery({ maxWidth: 599 })
  const [serverError, setServerError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const details = serverError ? detailsSentence(serverError, errorContext) : null

  async function handleSubmit(event) {
    event.preventDefault()
    const payload = validate()
    if (payload === null) return
    setServerError(null)
    setSubmitting(true)
    try {
      await onSubmit(payload)
    } catch (error) {
      setServerError(error)
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onClose={submitting ? undefined : onClose} aria-labelledby={id} fullScreen={isPhone}
      fullWidth maxWidth="sm">
      <Box component="form" onSubmit={handleSubmit} noValidate>
        <DialogTitle id={id}>{title}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1, pt: 1 }}>
          {children}
          {serverError && (
            <Alert severity="error">
              {messageFor(serverError)}
              {details && <Box component="span" sx={{ display: 'block', mt: 0.5 }}>{details}</Box>}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={submitting}>{submitLabel}</Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
