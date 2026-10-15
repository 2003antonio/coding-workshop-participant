import { useCallback, useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Snackbar from '@mui/material/Snackbar'
import { ToastContext } from './toast'

/** How long a toast stays, in ms. */
export const TOAST_MS = 4000

/**
 * One short success message at a time, bottom left, gone after TOAST_MS (or the
 * close button). A newer toast replaces the one on screen. Failures never use
 * this: they keep their inline error sentences. Never put secrets in a toast.
 *   const toast = useToast(); toast('Project created: Billing v2')
 */
export default function ToastProvider({ children }) {
  const [current, setCurrent] = useState(null) // { key, message }
  const [open, setOpen] = useState(false)

  const show = useCallback((message) => {
    setCurrent({ key: Date.now() + Math.random(), message })
    setOpen(true)
  }, [])

  function handleClose(event, reason) {
    if (reason === 'clickaway') return // a click elsewhere on the page is not "dismiss"
    setOpen(false)
  }

  const value = useMemo(() => show, [show])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Snackbar key={current?.key} open={open && Boolean(current)} autoHideDuration={TOAST_MS} onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        sx={{ bottom: { xs: 'calc(24px + env(safe-area-inset-bottom, 0px))', sm: 24 } }}>
        <Alert severity="success" variant="filled" role="status" aria-live="polite" onClose={() => setOpen(false)}
          closeText="Dismiss" sx={{ minWidth: { sm: 280 }, maxWidth: 480, boxShadow: 3, fontWeight: 500 }}>
          {current?.message}
        </Alert>
      </Snackbar>
    </ToastContext.Provider>
  )
}
