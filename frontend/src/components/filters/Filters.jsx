// The filter row above a list, the same on every page:
//   <FilterBar label="Filter employees">
//     <SearchField label="Search employees" value={search} onChange={setSearch} />
//     <SelectFilter label="Role" allLabel="All roles" value={role} onChange={setRole} options={[...]} />
//     <SwitchFilter label="Show archived" checked={archived} onChange={setArchived} />
//   </FilterBar>
// Matching and the empty-list sentence live in filterMath.js.
import { useRef } from 'react'
import Box from '@mui/material/Box'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import MenuItem from '@mui/material/MenuItem'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import ClearOutlined from '@mui/icons-material/ClearOutlined'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { MAX_SEARCH } from './filterMath'

/**
 * A search region named `label`. Its controls sit in one row (`columns` is the CSS
 * grid template: the search box first and widest, `auto` for a switch), and in one
 * column on a phone. `align="start"` lines up controls of different heights by their top
 * (a field with helper text).
 */
export function FilterBar({ label, columns = '2fr 1fr 1fr auto', align = 'center', children }) {
  const { isPhone } = useBreakpoint()
  return (
    <Box role="search" aria-label={label} sx={{
      display: 'grid', gap: 2, mb: 2, alignItems: align,
      gridTemplateColumns: isPhone ? '1fr' : columns,
    }}>
      {children}
    </Box>
  )
}

/** A search box with a "Clear search" button once it holds text; clearing puts the cursor back in it. */
export function SearchField({ label, value, onChange, onClear }) {
  const box = useRef(null)
  function clear() {
    if (onClear) onClear()
    else onChange('')
    box.current?.focus()
  }
  return (
    <TextField label={label} type="search" size="small" value={value} inputRef={box}
      onChange={(e) => onChange(e.target.value)}
      slotProps={{
        htmlInput: { maxLength: MAX_SEARCH },
        input: value ? {
          endAdornment: (
            <InputAdornment position="end">
              <IconButton aria-label="Clear search" edge="end" onClick={clear} sx={{ width: 44, height: 44 }}>
                <ClearOutlined fontSize="small" />
              </IconButton>
            </InputAdornment>
          ),
        } : undefined,
      }} />
  )
}

/** A dropdown whose first choice, `allLabel` (value ''), means no filter. options: [{ value, label }]. */
export function SelectFilter({ label, allLabel, value, onChange, options }) {
  return (
    <TextField select label={label} size="small" value={value} onChange={(e) => onChange(e.target.value)}>
      <MenuItem value="">{allLabel}</MenuItem>
      {options.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
    </TextField>
  )
}

/** An on/off filter such as "Show archived" or "Only overdue". */
export function SwitchFilter({ label, checked, onChange }) {
  return (
    <FormControlLabel label={label} sx={{ minHeight: 44, mr: 0 }} control={
      <Switch checked={checked} onChange={(e) => onChange(e.target.checked)} />
    } />
  )
}
