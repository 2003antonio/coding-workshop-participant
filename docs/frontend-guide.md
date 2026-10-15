# How to keep expanding the frontend

This is how I add to the ACME Project Tracker frontend without breaking what
works. Every example below is copied from a real file in `frontend/src/`.

## 1. How the frontend is organised

A screen asks for data in three steps, always in this order:

```
pages/ and components/   what you see (React + Material UI)
        │
auth/ and hooks/         who is signed in, the access token, loading state
        │
services/*.js            the ONLY files that call fetch (one function per endpoint)
        │
backend  /api/...        described in docs/api-contract.md
```

**The one rule: only files in `services/` call `fetch`.** Pages never call
`fetch` and never touch tokens. A page hands a service function the access
token through `useApi()` / `useLoad()`, and the service turns it into an HTTP
request with `apiClient.js`.

| Folder or file | What it holds |
|---|---|
| `src/pages/` | One file per screen (`ProjectsPage.jsx`, ...) plus display helpers (`format.js`, `apiMessages.js`). |
| `src/components/` | Shared pieces: `AppShell` (sidebar + top bar), `PageState` (loading / error / empty), `ResponsiveTable` (table on desktop, cards on a phone, paged), `Paginated` (any long list a page at a time), `filters/` (the search and filter row), dialogs, report views. |
| `src/services/` | One file per backend area (`teamService.js`, `projectService.js`, ...). `apiClient.js` has `request()` and `toQuery()`. |
| `src/auth/` | `AuthContext` (the session), `useApi` / `useLoad`, `roles.js` (which role sees what), `ProtectedRoute`. |
| `src/hooks/useBreakpoint.js` | `{ isPhone, isTablet, isDesktop }` for layout decisions. |
| `src/routes.jsx` | The route table. Every page is lazy-loaded. |
| `src/navigation.js` | The sidebar links, one line each. |
| `src/theme.js` | Colours (light and dark), font, shapes, status colours. |
| `src/test/` | The fake backend for tests (`fakeApiServer.js`, `fakeHandlers/`) and `renderApp`. |

## 2. Add a page

1. Create `src/pages/MyWorkPage.jsx`. Wrap it in `AppShell` and give it one `h1`:

   ```jsx
   import Typography from '@mui/material/Typography'
   import AppShell from '../components/AppShell'
   import { useBreakpoint } from '../hooks/useBreakpoint'

   export default function MyWorkPage() {
     const { isPhone } = useBreakpoint()
     return (
       <AppShell maxWidth="lg">
         <Typography variant={isPhone ? 'h5' : 'h4'} component="h1">My work</Typography>
       </AppShell>
     )
   }
   ```

2. Add one line to `src/routes.jsx` (inside `PROTECTED_ROUTES` if you must be signed in):

   ```js
   { path: '/my-work', Page: lazyPage(() => import('./pages/MyWorkPage')) },
   ```

3. If it needs a sidebar link, add one line to `src/navigation.js`. `visible`
   is optional and hides the link for roles that can't use the page:

   ```js
   { to: '/my-work', label: 'My work', icon: WorkOutlined },
   ```

   (`import WorkOutlined from '@mui/icons-material/WorkOutlined'` at the top.)
   The top bar title comes from this label automatically.

Hiding a link is only a courtesy. The server checks the role on every request,
so the page must still handle a refusal (a 403) politely.

## 3. Add an API call

**Contract first.** If the endpoint or field is not in `docs/api-contract.md`,
stop: agree the contract change first. I never invent fields.

1. Add a function to the right file in `src/services/`. It takes the access
   token first and uses `request()` / `toQuery()` from `apiClient.js`. From
   `services/teamService.js`:

   ```js
   /** GET / -> [team] (admin: all; manager: teams they lead; employee: own team) */
   export async function listTeams(accessToken, { includeArchived = false } = {}) {
     const data = await request(`/teams/${toQuery({ include_archived: includeArchived })}`, accessToken)
     return data.teams
   }
   ```

2. Add a unit test with a fake `fetch`, like `services/apiServices.test.js`
   does with its `mockFetch(status, body)` helper: check the URL, the method,
   the body and what the function returns.

3. Use it in a page with `useLoad` and show it with `LoadState`. From
   `pages/TeamsPage.jsx`:

   ```jsx
   const load = useCallback((call) => call((token) => teamService.listTeams(token)), [])
   const teams = useLoad(load)
   ...
   <LoadState result={teams} label="Loading teams" skeleton="table">
     {(rows) => <ResponsiveTable label="Teams" rows={rows} empty={emptyText} columns={...} />}
   </LoadState>
   ```

   - The load function **must** be wrapped in `useCallback`. A new function
     means "load something else": `useLoad` shows loading until it answers and
     never shows the previous answer as the new one. `reload()` loads the same
     thing again and keeps the old data on screen meanwhile.
   - Give each independent data source its own `useLoad`, so one failing card
     never blanks the whole page.
   - `error` is always a fixed friendly message (from `pages/apiMessages.js`),
     never the server's text.

## 4. Add a component

Every view that shows data has three states:

| State | What to show | How |
|---|---|---|
| Loading | Grey placeholder shapes in the shape of the content | `<LoadState skeleton="table">` or `<LoadingSkeleton variant="cards" label="Loading budget" />`. Variants: `cards`, `table`, `list`, `chart`, `detail`. The label must start with "Loading" (E2E tests wait for every "Loading ..." status to disappear). |
| Error | A friendly sentence and "Try again" | `LoadState` does it; on your own use `<LoadError message={...} onRetry={reload} />`. |
| Empty | One sentence: what's missing and what to do | `<Empty>No projects to show yet.</Empty>` |

Accessibility checklist:
- Every button, field and icon button has an accessible name (`aria-label` on icon-only buttons).
- Tap targets are at least 44 px (`sx={{ minHeight: 44 }}` or `width/height: 44` on icon buttons).
- Colour is never the only signal: a status chip always has a text label.
- Charts, heat-maps and timelines also have a text version (a visually hidden table, or an `aria-label` per item).
- Decorative icons stay `aria-hidden` (MUI icons are by default).

Dark mode: never hard-code a hex colour in a component. Use theme names in
`sx` (`color: 'text.secondary'`, `bgcolor: 'background.paper'`,
`borderColor: 'divider'`) or `toneSx('done')` for a status colour. Then the
component is right in both modes for free.

Phone: check it at 390 px wide. Use `useBreakpoint()` and `ResponsiveTable`
(it turns rows into cards on a phone).

### Long lists: search, filters and pages

Lists arrive whole from the API (only the activity feed pages on the server), so a
page filters and pages them in the browser, always in this order:

```jsx
<FilterBar label="Filter employees" columns="2fr 1fr 1fr auto">      {/* components/filters/Filters.jsx */}
  <SearchField label="Search employees" value={search} onChange={setSearch} />
  <SelectFilter label="Role" allLabel="All roles" value={role} onChange={setRole} options={optionsOf(ROLE_LABELS)} />
  <SwitchFilter label="Show archived" checked={archived} onChange={setArchived} />
</FilterBar>
...
const term = searchTerm(search)                                     // components/filters/filterMath.js
const rows = all.filter((e) => matches(term, e.name, e.email) && (!role || e.role === role))
<ResponsiveTable rows={rows} empty={emptyText('employees', { term, filtered: Boolean(role), none: 'No employees yet.' })} ... />
```

- `ResponsiveTable` pages by itself (25 rows). Anything else long goes inside
  `<Paginated rows={rows} label="Teams">{(pageRows) => ...}</Paginated>`; a filter
  that changes the row count sends it back to page 1.
- `matches` works like the server's `q`: case-insensitive, plain text. A list the
  server can search (Projects) sends `q` after `SEARCH_DELAY_MS` instead.
- Keep the names: the bar is "Filter <things>", the box "Search <things>", the
  first dropdown choice "All <things>". Tests and E2E find them by these names.

## 5. Add a test

Page tests render the whole app against a fake backend that follows the
contract and its role rules.

```jsx
import { screen, within } from '@testing-library/react'
import { reply, signedInAs } from '../test/fakeApiServer'
import { renderApp } from '../test/renderApp'

it('an employee sees only their projects', async () => {
  signedInAs('employee')                       // or 'admin', 'manager', or a user id like 'u-6'
  renderApp('/projects')
  await screen.findByRole('table', { name: 'Projects' })
  ...
})
```

- **A role:** `signedInAs('admin' | 'manager' | 'employee')`. The fake server
  hides what that role may not see, the same way the real one does.
- **A server refusal or crash:** override one exact route for this test only:

  ```jsx
  signedInAs('employee', { routes: { 'GET /api/projects/': () => reply(500, {}) } })
  ```

- **A phone:** `renderApp('/projects', { width: 390 })`. Below 900 px the
  sidebar is a drawer behind the "Menu" button.
- **A new endpoint** in the fake server: don't grow `fakeApiServer.js`. Add a
  file in `src/test/fakeHandlers/` and list it in `fakeHandlers/index.js` (its
  header comment shows the shape). Handlers get `{ body, query, params }` plus
  `db`, `me()` and `today`.
- **Check what was sent:** `server.calls`, `server.count('POST', '/api/teams/')`.
- **Prove the test is real:** break the code on purpose, watch the test fail, put it back.

## 6. The theme, and adding a status colour

Everything lives in `src/theme.js`: the light and dark palettes, the Inter
font, rounded cards, and `STATUS_COLORS`.

To add a status colour (say `at_risk`), add it to **both** modes:

```js
export const STATUS_COLORS = {
  light: { ..., at_risk: { fg: '#8A4600', bg: '#FFF1DB' } },
  dark:  { ..., at_risk: { fg: '#FFD48A', bg: '#45320F' } },
}
```

then use it with `<Chip label="At risk" sx={toneSx('at_risk')} />`.
`theme.test.js` checks every text/background pair in both modes reaches a
4.5:1 contrast ratio. If it fails, darken the light-mode text or lighten the
dark-mode text until it passes.

## 7. Preview locally, and the pre-commit checklist

Preview (needs the backend dev server already running on port 3001):

```powershell
cd frontend
npm run dev
```

Then open http://localhost:3000. Try it at 390 px wide, and in light and dark
(the sun/moon button in the top bar).

Before every commit, in `frontend/`:

```powershell
npm run lint        # must be clean
npm run coverage    # all tests pass, every total at or above 80%
npm run build       # must succeed
```

and stage files by name (never `git add .`).

## 8. Things that bite

- **Dates need the year.** Every week label uses `formatWeek` ("week of Dec 28, 2026")
  or `formatWeekShort` ("Dec 28 ’26") from `pages/format.js`. Dates are calendar
  days: read them as UTC, as `formatDate` does, or they shift a day.
- **Never show 0 for a hidden budget.** When the server sends `hidden_reason`,
  show `hiddenMessage(reason)`, never a number. Never render a salary, an hourly
  rate or a per-person cost for anyone but an admin.
- **Keep the E2E names.** The Playwright tests find things by their accessible
  names: the `Main` navigation and its links (Home, Projects, Teams, Reports,
  Employees), "Sign out", "Menu", each page's `h1`, the "Loading ..." statuses,
  tab, table, dialog and button names. Renaming one breaks E2E.
- **No new packages without asking.** Charts, heat-maps and timelines are drawn
  with MUI plus SVG/CSS.
- **Load functions in `useCallback`.** A load function created on every render
  reloads forever.
- **Pages never call `fetch`.** If you need data, write a service function.
