// Which roles see which parts of the UI. Hiding a button is only a courtesy:
// the server checks every request again (backend/*/routes.py, docs/api-contract.md).

/** May open the Employees page (GET /api/employees/). */
export const EMPLOYEE_LIST_ROLES = ['admin', 'manager']

/** May see salaries and create, edit or archive employees. */
export const canManageEmployees = (role) => role === 'admin'

/** Only an admin ever sees a salary, an hourly rate or a per-person cost. */
export const canSeeSalaries = (role) => role === 'admin'

/** May create teams, change their lead and add or remove members. */
export const canManageTeams = (role) => role === 'admin'

/** May create projects (a manager only for teams they lead) and see archived ones. */
export const canCreateProjects = (role) => role === 'admin' || role === 'manager'

/** May change this project, its deliverables and allocations, and see its budget. */
export const canManageProject = (role, user, project) =>
  role === 'admin' || (role === 'manager' && Boolean(user) && project?.manager?.id === user.id)

/** May see this team's budget: admin, or the team's lead. */
export const canSeeTeamBudget = (role, user, team) =>
  role === 'admin' || (Boolean(user) && team?.lead?.id === user.id)

/** Sees the dashboard on Home (it uses reports 2, 5 and 7, which employees may not open). */
/** The Activity feed (audit log): admin everything, a manager their teams' projects. */
export const canSeeActivity = (role) => role === 'admin' || role === 'manager'

export const canSeeDashboard = (role) => role === 'admin' || role === 'manager'

/** Reports each role may open (§8); employees get 403 on the others. */
const REPORTS_FOR_ROLE = {
  admin: ['status', 'risk', 'resources', 'deliverables', 'capacity', 'chain', 'budget'],
  manager: ['status', 'risk', 'resources', 'deliverables', 'capacity', 'chain', 'budget'],
  employee: ['status', 'resources', 'deliverables', 'chain'],
}
export const reportsFor = (role) => REPORTS_FOR_ROLE[role] ?? []
