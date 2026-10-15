import { createContext, useContext } from 'react'

/** The toast function from ToastProvider; outside one it does nothing. */
export const ToastContext = createContext(() => {})

/** const toast = useToast(); toast('Deliverable archived: Launch') */
export const useToast = () => useContext(ToastContext)
