import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { anyValue, useUrlFilter, useUrlFlag } from './useUrlFilter'

function Probe() {
  const [status, setStatus] = useUrlFilter('status', ['active', 'planned'])
  const [team, setTeam] = useUrlFilter('team', anyValue)
  const [over, setOver] = useUrlFlag('over')
  const { search } = useLocation()
  return (
    <>
      <p>{`status=${status}|team=${team}|over=${over}|url=${search}`}</p>
      <button type="button" onClick={() => setStatus('planned')}>planned</button>
      <button type="button" onClick={() => setStatus('')}>all statuses</button>
      <button type="button" onClick={() => setTeam('t-2')}>team</button>
      <button type="button" onClick={() => setOver(true)}>over on</button>
      <button type="button" onClick={() => setOver(false)}>over off</button>
    </>
  )
}
const at = (path) => render(<MemoryRouter initialEntries={[path]}><Probe /></MemoryRouter>)
const state = () => screen.getByRole('paragraph').textContent

describe('useUrlFilter / useUrlFlag', () => {
  it('read the address; a value not allowed means no filter', () => {
    at('/x?tab=budget&status=active&team=t-1&over=1')
    expect(state()).toBe('status=active|team=t-1|over=true|url=?tab=budget&status=active&team=t-1&over=1')
  })

  it('ignore unknown values and anything but 1 for a flag', () => {
    at('/x?status=bogus&team=&over=yes')
    expect(state()).toMatch(/^status=\|team=\|over=false\|/)
  })

  it('write to the address, keeping the other parameters; "" and off remove theirs', async () => {
    const user = userEvent.setup()
    at('/x?tab=budget&status=active')
    await user.click(screen.getByRole('button', { name: 'planned' }))
    await user.click(screen.getByRole('button', { name: 'team' }))
    await user.click(screen.getByRole('button', { name: 'over on' }))
    expect(state()).toBe('status=planned|team=t-2|over=true|url=?tab=budget&status=planned&team=t-2&over=1')

    await user.click(screen.getByRole('button', { name: 'all statuses' }))
    await user.click(screen.getByRole('button', { name: 'over off' }))
    expect(state()).toBe('status=|team=t-2|over=false|url=?tab=budget&team=t-2')
  })
})
