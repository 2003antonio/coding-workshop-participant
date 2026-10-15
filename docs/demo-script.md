# Demo script (about 5 minutes)

Before you start: `scripts\start-demo.ps1 -Reset` (fresh demo data, both servers, browser at
http://localhost:3000). Passwords are in `.env.local` under `DEMO_*`; never show that file.
Use a desktop window at least 1280 px wide.

## 1. Alex, admin (about 2 minutes)

Sign in as `admin@acme-demo.test`.

1. **Home.** Point at the **Portfolio health** bar: "1 of 3 projects healthy", one at risk, one over budget,
   each project counted once. Say: "Five cards under it, each one a link." Point at **At risk 2** and
   **Over budget 1**.
2. Click the **At risk** card. Reports opens on the **At risk** tab: Billing v2 (overdue deliverable,
   over budget) and Data lake (a dependency starts before its date).
3. Click **Billing v2**. The **health strip** under the title has three tiles:
   - **Budget**: **Over budget**, "Committed $41,180 of $38,000 planned (108%)", "Spent so far: 27%".
     Say: "The light bar is what the assignments commit, the dark part is what is spent so far, the
     line is the plan."
   - **Schedule**: "1 of 5 done, 1 overdue, 2 blocked", with a bar and every count in words.
   - **People**: four avatars and "4 people, 70 h this week".
   Click the **People** tab and change Ana's hours from 30 to 20 in place: the Budget tile says
   "Updating..." and its numbers drop at once, no reload. Put it back to 30. (Employees see Schedule
   and People only, never a budget tile.)
4. Click the **Dependencies** tab: the timeline, longest chain outlined, the red line is today.
5. Click **Employees** in the sidebar. Salaries show `$ ••••••`. Click the eye **Show salary for Ana
   Silva**: `$124,800.00`. Say: "Masked by default against shoulder-surfing; it hides again after 30
   seconds or when I leave the page. The server still sends it to an admin only."
6. Click **Reports**, then the **Resources** tab: the heat-map. Ana's 36 h weeks are amber ("near
   capacity").
7. **Activity (30 seconds).** Click **Activity** in the sidebar. Read a few rows near the top: "Alex Admin
   signed in", "Ken Ito changed the assignment of Gus Petrov on project 'Data lake' (hours per week)", "Marta
   Lopez archived deliverable 'Legacy CSV export'". Click the **People** chip: "Alex Admin changed a
   salary for Bo Chen". Say: "Every change is logged. A salary change says that it happened, never the
   number, and the server builds these sentences from a whitelist, so no amount can slip in." Hover a
   time to see the exact date.
8. Optional: click the chevron at the sidebar edge (**Collapse sidebar**) to show the icon rail, then
   expand it again.

Sign out.

## 2. Marta, manager (about 1.5 minutes)

Sign in as `marta@acme-demo.test`.

1. **Small groups are hidden.** Click **Projects**, then **Mobile app**. The Budget tile of the health
   strip says "Hidden: fewer than 3 people". Click the **Budget** tab: "Totals are hidden because fewer than 3 people are in this
   group, so they could reveal someone’s pay." The planned budget ($12,000.00) is still shown.
2. **The 40-hour limit.** Still on Mobile app, click **People**, then **Assign person**. Person: **Bo
   Chen**. Hours per week: **25**. Start date: the Monday two weeks from now; end date: the Sunday of the
   following week. Click **Assign**. The dialog refuses: "This would put the person over 40 hours in some
   weeks." and lists each week with 45 h. It never names Bo's other project. Click **Cancel**.
3. **No dependency loops.** Click **Projects**, then **Billing v2**. On the **Deliverables** tab, click
   **Dependencies** on the **API spec** row. Tick **Launch**, click **Save dependencies**. Refused: "That
   would make the dependencies go round in a loop." with "Loop: API spec -> Launch -> QA sign-off -> Build
   billing API -> API spec". Click **Cancel**.
4. **Archive, never delete.** Click **Projects**, then **Archive** on the **Mobile app** row. The dialog
   says "Its deliverables and assignments are archived too. Nothing is deleted." Click **Archive**: the
   project leaves the list. (Signed in as Alex, **Show archived** brings it back with an "Archived" chip.)
5. **Activity, scoped.** Click **Activity**. Marta sees only her team's projects: the chips are just
   **All, Projects, Deliverables, Assignments**, and the newest row is her own "Marta Lopez archived
   project 'Mobile app'". No sign-ins, no people, no salaries, and nothing about Ken's Data lake.

Sign out.

## 3. Hal, employee with no work (about 30 seconds)

Sign in as `hal@acme-demo.test`.

1. **Home:** "You are not assigned to any project yet" with what happens next and an **Open My work**
   button.
2. **Projects:** "No projects to show yet." **Teams:** "You aren't on a team yet." No errors anywhere.

Optional: sign in as `ana@acme-demo.test` for the employee Home with data: "30 h per week through the
week of Oct 19 ’26, then 36 h.", **This week 30 of 40 h**, the next deadline, an overdue deliverable and
her two projects.

## 4. Phone view (about 30 seconds)

Open the browser's device toolbar at 390 × 844 (or resize the window narrow). The sidebar becomes a
**Menu** button; tables turn into cards; nothing scrolls sideways. Open **Menu** → **My work** to show
the hours chart with its legend ("32 h = near capacity", "40 h = weekly limit").

## What is not done (say it plainly)

- **No cloud demo.** The AWS deploy stopped at database creation because the account hit its RDS quota;
  everything you saw runs locally.
- **No audit log screen.** Every change is written to the audit log in the database, but there is no page
  to read it yet.
- **The salary mask is a display guard.** The API still sends salaries and rates to an admin; the mask
  only stops someone reading them off the screen.
- Lists are not paginated (sized for demo data), and `package-lock.json` is git-ignored, so installs are
  not pinned.
