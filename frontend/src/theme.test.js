import { describe, expect, it } from 'vitest'
import theme, { STATUS_COLORS, contrastRatio } from './theme'

const MODES = ['light', 'dark']
const AA = 4.5

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5)
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5)
    // MUI's old default orange chip: about 3:1, which is why it was replaced.
    expect(contrastRatio('#ED6C02', '#FFFFFF')).toBeLessThan(3.5)
  })
})

describe('status colours', () => {
  it('define the same statuses in both modes', () => {
    expect(Object.keys(STATUS_COLORS.dark)).toEqual(Object.keys(STATUS_COLORS.light))
    expect(Object.keys(STATUS_COLORS.light)).toEqual(
      expect.arrayContaining(['done', 'in_progress', 'not_started', 'overdue', 'blocked', 'over_budget']))
  })

  for (const mode of MODES) {
    for (const [status, { fg, bg }] of Object.entries(STATUS_COLORS[mode])) {
      it(`${mode} ${status}: text on background is at least 4.5:1`, () => {
        expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA)
      })
    }
  }
})

describe('palette colours used as text or on buttons', () => {
  for (const mode of MODES) {
    const palette = theme.colorSchemes[mode].palette
    for (const name of ['primary', 'secondary', 'error', 'warning', 'success']) {
      it(`${mode} ${name}: readable on the page, on cards and as a filled chip`, () => {
        const { main, contrastText } = palette[name]
        expect(contrastRatio(main, palette.background.paper)).toBeGreaterThanOrEqual(AA)
        expect(contrastRatio(main, palette.background.default)).toBeGreaterThanOrEqual(AA)
        expect(contrastRatio(contrastText, main)).toBeGreaterThanOrEqual(AA)
      })
    }
    it(`${mode}: body and secondary text are readable`, () => {
      for (const text of [palette.text.primary, palette.text.secondary]) {
        expect(contrastRatio(text, palette.background.paper)).toBeGreaterThanOrEqual(AA)
        expect(contrastRatio(text, palette.background.default)).toBeGreaterThanOrEqual(AA)
      }
      expect(contrastRatio(palette.sidebar.fg, palette.sidebar.bg)).toBeGreaterThanOrEqual(AA)
    })
  }
})
