// Every demo account: signs in, sees the right menu, opens every page it can use
// (each project tab and report tab too) and saves a screenshot of each to
// docs/screenshots/<account>/. Pages for non-admins must show no salary, rate,
// password or token. Read-only, so it runs before the flows that change data.

import { expect, test } from '@playwright/test'
import {
  ACCOUNTS, MENU, REPORT_TABS, demoSalaries, expectNothingPrivate, mainMenu, openFromMenu, settle, signIn, slug, snap,
} from './demo.js'

// What each account opens: one project and one team it can see (none for hal),
// and the project tabs it should get there.
const PLAN = {
  admin: { project: 'Billing v2', tabs: ['Deliverables', 'People', 'Budget', 'Dependencies'], team: 'Platform' },
  marta: { project: 'Billing v2', tabs: ['Deliverables', 'People', 'Budget', 'Dependencies'], team: 'Platform' },
  ken: { project: 'Data lake', tabs: ['Deliverables', 'People', 'Budget', 'Dependencies'], team: 'Data' },
  ana: { project: 'Billing v2', tabs: ['Deliverables', 'People', 'Dependencies'], team: 'Platform' },
  hal: {},
}

let salaries = []
test.beforeAll(async ({ request }) => {
  salaries = await demoSalaries(request)
})

for (const [key, account] of Object.entries(ACCOUNTS)) {
  const plan = PLAN[key]

  test(`${key} (${account.role}): menu, every page, no private data, screenshots`, async ({ page }) => {
    const session = await signIn(page, key)
    let shot = 0
    const visit = async (name) => {
      await settle(page)
      if (account.role !== 'admin') await expectNothingPrivate(page, { secrets: session.secrets, salaries }, name)
      shot += 1
      await snap(page, key, `${String(shot).padStart(2, '0')}-${name}`)
    }

    await expect(mainMenu(page).getByRole('link')).toHaveText(MENU[account.role])
    await visit('home')

    await openFromMenu(page, 'Projects')
    await visit('projects')
    if (plan.project) {
      await page.getByRole('link', { name: plan.project, exact: true }).click()
      await expect(page.getByRole('heading', { level: 1, name: plan.project })).toBeVisible()
      const tabs = page.getByRole('tablist', { name: 'Project sections' }).getByRole('tab')
      await expect(tabs).toHaveText(plan.tabs)
      for (const tab of plan.tabs) {
        await tabs.filter({ hasText: tab }).click()
        await visit(`project-${slug(plan.project)}-${slug(tab)}`)
      }
    }

    await openFromMenu(page, 'Teams')
    await visit('teams')
    if (plan.team) {
      await page.getByRole('link', { name: plan.team, exact: true }).click()
      await expect(page.getByRole('heading', { level: 1, name: plan.team })).toBeVisible()
      await visit(`team-${slug(plan.team)}`)
    }

    await openFromMenu(page, 'Reports')
    const reportTabs = page.getByRole('tablist', { name: 'Reports' }).getByRole('tab')
    await expect(reportTabs).toHaveText(REPORT_TABS[account.role])
    for (const tab of REPORT_TABS[account.role]) {
      await reportTabs.filter({ hasText: new RegExp(`^${tab}$`) }).click()
      await settle(page)
      if (tab === 'Dependencies' && plan.project) {
        await page.getByRole('combobox', { name: 'Project' }).click()
        await page.getByRole('option', { name: plan.project, exact: true }).click()
        // The chain view shows no spinner while it loads, so wait for the chain itself.
        await expect(page.getByText('Longest chain:')).toBeVisible()
      }
      await visit(`report-${slug(tab)}`)
    }

    if (MENU[account.role].includes('Employees')) {
      await openFromMenu(page, 'Employees')
      await expect(page.getByRole('columnheader', { name: 'Salary' })).toHaveCount(account.role === 'admin' ? 1 : 0)
      await visit('employees')
    }
  })
}

test('marta: Mobile app has 1 person, so its budget is hidden, not shown as numbers', async ({ page }) => {
  const session = await signIn(page, 'marta')
  await openFromMenu(page, 'Projects')
  await page.getByRole('link', { name: 'Mobile app', exact: true }).click()
  await page.getByRole('tab', { name: 'Budget' }).click()
  await expect(page.getByText(/Totals are hidden because fewer than 3 people are in this group/)).toBeVisible()
  await expectNothingPrivate(page, { secrets: session.secrets, salaries }, 'the Mobile app budget')
  await snap(page, 'marta', 'project-mobile-app-budget-hidden')
})
