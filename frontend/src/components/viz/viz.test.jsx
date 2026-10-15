import { render, screen, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it } from 'vitest'
import theme from '../../theme'
import Avatar, { AvatarStack } from './Avatar'
import DueChip from './DueChip'
import HoursMeter from './HoursMeter'
import ProjectTile from './ProjectTile'
import Sparkline from './Sparkline'
import StatusBar from './StatusBar'
import { colorIndex, dueInfo, initials, trendOf } from './vizMath'

const show = (ui) => render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)

describe('StatusBar', () => {
  it('says every non-empty count in words; the bar itself is hidden', () => {
    show(<StatusBar label="Deliverables by status" segments={[
      { key: 'done', label: 'Done', count: 5, tone: 'done' },
      { key: 'progress', label: 'In progress', count: 2, tone: 'in_progress' },
      { key: 'blocked', label: 'Blocked', count: 0, tone: 'blocked' },
    ]} />)
    const legend = screen.getByRole('list', { name: 'Deliverables by status' })
    expect(within(legend).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Done 5', 'In progress 2'])
    expect(screen.getByTestId('status-bar').querySelectorAll('[data-tone]')).toHaveLength(2)
  })
})

describe('Sparkline', () => {
  it('is one image named with the range and trend', () => {
    show(<Sparkline values={[20, 20, 36]} what="Hours per week, next 3 weeks" unit=" h" limit={40} />)
    expect(screen.getByRole('img', {
      name: 'Hours per week, next 3 weeks: from 20 h to 36 h, rising; lowest 20 h, highest 36 h.',
    })).toBeInTheDocument()
    expect(trendOf([5, 5, 5])).toBe('flat')
    expect(trendOf([9, 4])).toBe('falling')
  })
})

describe('Avatar and AvatarStack', () => {
  it('show initials on a colour that is the same every time; the stack names everyone and counts the rest', () => {
    expect(initials('Ana Silva')).toBe('AS')
    expect(initials('Platform')).toBe('PL')
    expect(colorIndex('Ana Silva')).toBe(colorIndex('Ana Silva'))
    show(<><Avatar name="Ana Silva" /><AvatarStack names={['A One', 'B Two', 'C Three', 'D Four', 'E Five', 'F Six']} /></>)
    expect(screen.getByRole('img', { name: 'Ana Silva' })).toHaveAttribute('data-initials', 'AS')
    const stack = screen.getByRole('img', { name: '6 people: A One, B Two, C Three, D Four, E Five, F Six' })
    expect(stack).toHaveTextContent('+2')
  })
})

describe('DueChip', () => {
  it('counts calendar days from local today', () => {
    expect(dueInfo('2026-10-17', '2026-10-14').text).toBe('Due in 3 days')
    expect(dueInfo('2026-10-14', '2026-10-14').text).toBe('Due today')
    expect(dueInfo('2026-10-12', '2026-10-14')).toEqual({ text: '2 days overdue', tone: 'overdue' })
    expect(dueInfo('2026-10-12', '2026-10-14', true).text).toBe('Done')
    show(<DueChip due="2026-10-13" today="2026-10-14" />)
    expect(screen.getByText('1 day overdue')).toBeInTheDocument()
  })
})

describe('ProjectTile', () => {
  it('is decorative initials beside the name', () => {
    show(<ProjectTile name="Billing v2" />)
    const tile = screen.getByTestId('project-tile')
    expect(tile).toHaveAttribute('data-initials', 'BV')
    expect(tile).toHaveTextContent('')
    expect(tile).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('HoursMeter', () => {
  it('names the hours against the 40 h limit', () => {
    show(<HoursMeter hours={24} />)
    expect(screen.getByRole('img', { name: '24 of 40 hours a week' })).toBeInTheDocument()
  })
})
