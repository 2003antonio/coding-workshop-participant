// Which roles see which parts of the UI. Hiding a button is only a courtesy:
// the server checks every request again (backend/employees/routes.py).

/** May open the Employees page (GET /api/employees/). */
export const EMPLOYEE_LIST_ROLES = ['admin', 'manager']

/** May see salaries and create, edit or archive employees. */
export const canManageEmployees = (role) => role === 'admin'
