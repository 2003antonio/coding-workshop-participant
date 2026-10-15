// One real flow per role, against the re-seeded demo data (scripts/seed_demo.py):
// admin creates a project, marta assigns a person (and sees the readable 40-hour
// and dependency-loop errors), hal sees the empty states.

import { expect, test } from '@playwright/test'
import { dayFromMonday, openFromMenu, settle, signIn, snap } from './demo.js'

const weekLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const shortDay = (date) => weekLabel.format(new Date(`${date}T00:00:00Z`))

/** Open a project from the Projects page. */
async function openProject(page, name) {
  await openFromMenu(page, 'Projects')
  await page.getByRole('link', { name, exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  await settle(page)
}

/** Open the Assign dialog on the People tab and fill it in. */
async function fillAssign(page, project, person, hours, dates) {
  await page.getByRole('tab', { name: 'People' }).click()
  await page.getByRole('button', { name: 'Assign person' }).click()
  const dialog = page.getByRole('dialog', { name: `Assign someone to ${project}` })
  await dialog.getByRole('combobox', { name: 'Person' }).click()
  await page.getByRole('option', { name: new RegExp(`^${person} `) }).click()
  await dialog.getByRole('textbox', { name: 'Hours per week' }).fill(String(hours))
  if (dates) {
    await dialog.getByLabel('Start date').fill(dates.start)
    await dialog.getByLabel('End date').fill(dates.end)
  }
  return dialog
}

test('admin creates a project', async ({ page }) => {
  const name = 'Website refresh'
  await signIn(page, 'admin')
  await openFromMenu(page, 'Projects')
  await page.getByRole('button', { name: 'New project' }).click()
  const dialog = page.getByRole('dialog', { name: 'New project' })
  await dialog.getByRole('combobox', { name: 'Team' }).click()
  await page.getByRole('option', { name: 'Platform', exact: true }).click()
  await dialog.getByRole('textbox', { name: 'Project name' }).fill(name)
  await dialog.getByRole('textbox', { name: 'Description' }).fill('New marketing site, made by the end-to-end tests.')
  await dialog.getByLabel('Start date').fill(dayFromMonday(7))
  await dialog.getByLabel('End date').fill(dayFromMonday(97))
  await dialog.getByRole('textbox', { name: /Planned budget/ }).fill('25000')
  await dialog.getByRole('button', { name: 'Create project' }).click()

  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  await expect(page.getByText(/^Platform · Manager: Marta Lopez/)).toBeVisible() // the team's lead manages it
  await snap(page, 'admin', 'flow-project-created')
  await openFromMenu(page, 'Projects')
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible()
})

test('marta assigns a Platform member to Mobile app, and is offered only Platform members', async ({ page }) => {
  await signIn(page, 'marta')
  await openProject(page, 'Mobile app')
  await page.getByRole('tab', { name: 'People' }).click()
  await page.getByRole('button', { name: 'Assign person' }).click()
  const dialog = page.getByRole('dialog', { name: 'Assign someone to Mobile app' })
  await dialog.getByRole('combobox', { name: 'Person' }).click()
  await expect(page.getByRole('option')).toHaveText([
    'Ana Silva (Senior Engineer)', 'Bo Chen (Engineer)', 'Cy Okafor (Engineer)', 'Di Novak (QA Engineer)',
  ])
  await page.getByRole('option', { name: /^Cy Okafor / }).click()
  await dialog.getByRole('textbox', { name: 'Hours per week' }).fill('10')
  await dialog.getByRole('button', { name: 'Assign' }).click()

  await expect(page.getByRole('status').filter({ hasText: 'Person assigned: Cy Okafor' })).toBeVisible()
  await expect(page.getByRole('table', { name: 'Assignments' }).getByRole('rowheader', { name: 'Cy Okafor' }))
    .toBeVisible()
  await snap(page, 'marta', 'flow-person-assigned')
})

test('marta: going over 40 hours names each week and its hours', async ({ page }) => {
  // Bo has 20 h/week on Billing v2 until well after these two weeks (seed), so 25 h more is 45 h.
  const start = dayFromMonday(14)
  const end = dayFromMonday(27)
  await signIn(page, 'marta')
  await openProject(page, 'Mobile app')
  const dialog = await fillAssign(page, 'Mobile app', 'Bo Chen', 25, { start, end })
  await dialog.getByRole('button', { name: 'Assign' }).click()

  await expect(dialog.getByText('This would put the person over 40 hours in some weeks.')).toBeVisible()
  await expect(dialog.getByText(
    `Over 40 hours in: week of ${shortDay(start)} (45 h), week of ${shortDay(dayFromMonday(21))} (45 h)`,
    { exact: true },
  )).toBeVisible()
  await expect(dialog.getByText(/Billing v2/)).toHaveCount(0) // the other project is never named
  await snap(page, 'marta', 'flow-over-40-hours')
})

test('marta: a dependency loop is refused and named with deliverable names', async ({ page }) => {
  await signIn(page, 'marta')
  await openProject(page, 'Billing v2')
  await page.getByRole('button', { name: 'Edit dependencies of API spec' }).click()
  const dialog = page.getByRole('dialog', { name: 'Dependencies of API spec' })
  // Launch depends on QA sign-off, which depends on Build billing API, which depends on API spec.
  await dialog.getByRole('checkbox', { name: /^Launch \(due/ }).check()
  await dialog.getByRole('button', { name: 'Save dependencies' }).click()

  await expect(dialog.getByText('That would make the dependencies go round in a loop.')).toBeVisible()
  await expect(dialog.getByText('Loop: API spec -> Launch -> QA sign-off -> Build billing API -> API spec',
    { exact: true })).toBeVisible()
  await snap(page, 'marta', 'flow-dependency-loop')
})

test('hal (no team, no allocations) sees empty states, not errors', async ({ page }) => {
  await signIn(page, 'hal')
  await openFromMenu(page, 'Projects')
  await expect(page.getByText('No projects to show yet.')).toBeVisible()
  await snap(page, 'hal', 'flow-empty-projects')
  await openFromMenu(page, 'Teams')
  await expect(page.getByText("You aren't on a team yet.")).toBeVisible()

  await openFromMenu(page, 'Reports')
  await expect(page.getByText('No projects to report on.')).toBeVisible()
  await page.getByRole('tab', { name: 'Deliverables' }).click()
  await expect(page.getByText('No deliverables to report on.')).toBeVisible()
  await page.getByRole('tab', { name: 'Dependencies' }).click()
  await expect(page.getByText('No projects to show.')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0)
})
