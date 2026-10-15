// Small helpers for the employee form (EmployeeFormDialog.jsx).
import { EMAIL_DOMAIN } from '../config'

/** "70000.5" -> "70,000.5" (separators in the whole part only); anything else stays as typed. */
export function withSeparators(text) {
  const plain = text.trim().replace(/,/g, '')
  const match = /^(\d+)(\.\d*)?$/.exec(plain)
  if (!match) return text
  return match[1].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (match[2] ?? '')
}
export const plainSalary = (text) => text.trim().replace(/,/g, '')

/** The email that is sent: a full address as typed, or the part before the @ plus EMAIL_DOMAIN. */
export function fullEmail(text) {
  const value = text.trim()
  return value.includes('@') ? value : `${value}@${EMAIL_DOMAIN}`
}
