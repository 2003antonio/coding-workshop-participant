import { useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'

/** Off screen but read by screen readers. */
const visuallyHidden = {
  position: 'absolute', width: '1px', height: '1px', p: 0, m: '-1px', overflow: 'hidden',
  clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
}

/**
 * A value that the right people can change in place. Until then it is a real
 * button showing the value (name: "<value>, change <what>"). Clicking it turns
 * it into a field: Enter or leaving the field saves, Escape cancels. The new
 * value shows at once while it saves; if onSave rejects, the old value comes
 * back (the caller says why). Without canEdit it is plain text.
 *
 *   value      the raw value ("20", "2026-11-09", "Backend")
 *   format     raw -> the text shown (default: as is)
 *   what       what changes, for the names: "hours per week of Eve Employee"
 *   type       input type: 'text' | 'date'; inputProps go to the <input>
 *   validate   raw -> a problem in words, or null
 *   onSave     raw -> promise
 */
export default function InlineEditCell({
  value, format = (v) => v, what, type = 'text', inputProps, validate, onSave, canEdit = true,
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState('')
  const [pending, setPending] = useState(null) // { from, to }: shown while saving, until `value` moves on
  const button = useRef(null)
  const done = useRef(false) // Enter or Escape already finished this edit (blur follows)

  const saving = Boolean(pending) && pending.from === value // cleared once the saved value arrives
  const shown = saving ? pending.to : value
  if (!canEdit) return format(value)

  function start() {
    setDraft(String(shown))
    setProblem('')
    done.current = false
    setEditing(true)
  }

  function stop() {
    done.current = true
    setEditing(false)
    setTimeout(() => button.current?.focus())
  }

  async function save() {
    const next = type === 'text' ? draft.trim() : draft
    if (next === String(value)) return stop()
    const found = validate?.(next)
    if (found) {
      setProblem(found)
      return undefined
    }
    stop()
    setPending({ from: value, to: next })
    try {
      await onSave(next)
    } catch {
      setPending(null) // roll back; the caller shows the friendly message
    }
    return undefined
  }

  function onKeyDown(event) {
    if (event.key === 'Enter') {
      event.preventDefault()
      save()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      stop()
    }
  }

  if (editing) {
    return (
      <TextField size="small" type={type} value={draft} autoFocus label={`Change ${what}`}
        onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown}
        onBlur={() => { if (!done.current) save() }}
        error={Boolean(problem)} helperText={problem || 'Enter saves, Escape cancels'}
        slotProps={{ htmlInput: inputProps, inputLabel: { shrink: true } }}
        sx={{ minWidth: type === 'date' ? 170 : 120, my: 0.5 }} />
    )
  }
  return (
    <Button ref={button} variant="text" size="small" onClick={start} aria-busy={saving ? 'true' : undefined}
      sx={{
        minHeight: 44, px: 1, mx: -1, color: 'inherit', fontWeight: 'inherit', textAlign: 'inherit',
        justifyContent: 'flex-start', textDecoration: 'underline dotted', textUnderlineOffset: 4,
        opacity: saving ? 0.7 : 1,
      }}>
      {format(shown)}
      <Box component="span" sx={visuallyHidden}>, change {what}</Box>
    </Button>
  )
}
