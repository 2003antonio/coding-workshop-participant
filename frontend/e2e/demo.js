// Shared helpers for the end-to-end tests: the demo accounts (scripts/seed_demo.py),
// signing in through the login form, and the checks run on every page.
//
// Passwords come from DEMO_*_PASSWORD (environment, else the repo-root .env.local)
// and are only typed into the password field. Passwords and tokens are never
// logged, and assertions about them never put them in a failure message.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const API_URL = 'http://localhost:3001/api'
const SCREENSHOTS = path.join(REPO_ROOT, 'docs', 'screenshots')

/** KEY=VALUE pairs from .env.local, read the same way as scripts/local_env.py. */
function readLocalEnv() {
  const file = path.join(REPO_ROOT, '.env.local')
  if (!fs.existsSync(file)) return {}
  const values = {}
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const at = line.indexOf('=')
    values[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return values
}
const localEnv = readLocalEnv()

function password(variable) {
  const value = process.env[variable] ?? localEnv[variable] ?? ''
  if (!value) throw new Error(`${variable} is not set (environment or .env.local)`)
  return value
}

export const ACCOUNTS = {
  admin: { name: 'Alex Admin', role: 'admin', passwordVar: 'DEMO_ADMIN_PASSWORD', folder: 'admin' },
  marta: { name: 'Marta Lopez', role: 'manager', passwordVar: 'DEMO_MANAGER_PASSWORD', folder: 'manager-marta' },
  ken: { name: 'Ken Ito', role: 'manager', passwordVar: 'DEMO_MANAGER_PASSWORD', folder: 'manager-ken' },
  ana: { name: 'Ana Silva', role: 'employee', passwordVar: 'DEMO_EMPLOYEE_PASSWORD', folder: 'employee-ana' },
  hal: { name: 'Hal Reyes', role: 'employee', passwordVar: 'DEMO_EMPLOYEE_PASSWORD', folder: 'employee-hal' },
}
export const emailOf = (key) => `${key}@acme-demo.test`

/** The main menu each role should see (components/AppShell.jsx). */
export const MENU = {
  admin: ['Home', 'My work', 'Projects', 'Teams', 'Reports', 'Employees'],
  manager: ['Home', 'My work', 'Projects', 'Teams', 'Reports', 'Employees'],
  employee: ['Home', 'My work', 'Projects', 'Teams', 'Reports'],
}

/** The report tabs each role should see (auth/roles.js, contract §8). */
export const REPORT_TABS = {
  admin: ['Project status', 'At risk', 'Resources', 'Deliverables', 'Near capacity', 'Dependencies', 'Budget'],
  manager: ['Project status', 'At risk', 'Resources', 'Deliverables', 'Near capacity', 'Dependencies', 'Budget'],
  employee: ['Project status', 'Resources', 'Deliverables', 'Dependencies'],
}

/**
 * Sign in as `key` through the login form and wait for the home page.
 * Returns the password and the tokens the server sent, for expectNothingPrivate().
 */
export async function signIn(page, key) {
  const account = ACCOUNTS[key]
  const secret = password(account.passwordVar)
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'Email' }).fill(emailOf(key))
  await page.locator('input[name="password"]').fill(secret)
  const loginResponse = page.waitForResponse(
    (r) => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Sign in' }).click()
  const response = await loginResponse
  expect(response.status(), `login as ${key}`).toBe(200)
  const body = await response.json()
  await expect(page.getByRole('heading', { level: 1, name: `Welcome, ${account.name}` })).toBeVisible()
  return { secrets: [secret, body.access_token, body.refresh_token] }
}

export const mainMenu = (page) => page.getByRole('navigation', { name: 'Main' })

/** Open a page from the main menu and wait for its heading. */
export async function openFromMenu(page, label, heading = label) {
  await mainMenu(page).getByRole('link', { name: label, exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
  await settle(page)
}

/** Wait until the network is quiet and no "Loading ..." spinner is left. */
export async function settle(page) {
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('status', { name: /^Loading/ })).toHaveCount(0)
}

/** Every annual salary, as admin sees it through the API (to look for leaks on other pages). */
export async function demoSalaries(request) {
  const login = await request.post(`${API_URL}/auth/login`,
    { data: { email: emailOf('admin'), password: password('DEMO_ADMIN_PASSWORD') } })
  expect(login.status(), 'admin API login').toBe(200)
  const { access_token: token, refresh_token: refresh } = await login.json()
  const list = await request.get(`${API_URL}/employees/`, { headers: { Authorization: `Bearer ${token}` } })
  const salaries = (await list.json()).employees.map((e) => e.salary)
  await request.post(`${API_URL}/auth/logout`, { data: { refresh_token: refresh } })
  return salaries
}

const money = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

/**
 * For a non-admin page: no password or token in the page text or URL, no salary
 * figure, and no salary, rate or per-person cost column.
 */
export async function expectNothingPrivate(page, { secrets, salaries }, where) {
  const text = await page.locator('body').innerText()
  const url = page.url()
  secrets.forEach((secret, i) => {
    const label = i === 0 ? 'the password' : 'a session token'
    expect(text.includes(secret) || url.includes(secret), `${label} is visible on ${where}`).toBe(false)
  })
  for (const word of [/salary/i, /hourly rate/i, /weekly cost/i]) {
    expect(word.test(text), `"${word.source}" is shown on ${where}`).toBe(false)
  }
  for (const salary of salaries) {
    for (const shown of [money.format(salary), whole.format(salary)]) {
      expect(text.includes(shown), `a salary (${shown}) is shown on ${where}`).toBe(false)
    }
  }
}

/** Save a full-page screenshot to docs/screenshots/<account folder>/<name>.png. */
export async function snap(page, key, name) {
  await settle(page)
  await page.evaluate(() => document.activeElement?.blur()) // no focus ripple on the last clicked tab
  await page.screenshot({
    path: path.join(SCREENSHOTS, ACCOUNTS[key].folder, `${name}.png`), fullPage: true, animations: 'disabled',
  })
}

/** "Billing v2" -> "billing-v2", for file names. */
export const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** This week's Monday (UTC, like the server) plus `days`, as YYYY-MM-DD. */
export function dayFromMonday(days) {
  const now = new Date()
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const monday = today - ((new Date(today).getUTCDay() + 6) % 7) * 86400000
  return new Date(monday + days * 86400000).toISOString().slice(0, 10)
}
