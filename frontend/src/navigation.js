// The sidebar links, in order. AppShell renders them; add a page with one line.
//   { to, label, icon, end?, visible?: (role) => boolean }
// `label` is the link's accessible name (E2E tests use it), `icon` is a
// @mui/icons-material component (shown aria-hidden), `end` matches the path
// exactly, `visible` hides the link for roles that can't use the page.
import AssessmentOutlined from '@mui/icons-material/AssessmentOutlined'
import BadgeOutlined from '@mui/icons-material/BadgeOutlined'
import FolderOutlined from '@mui/icons-material/FolderOutlined'
import GroupsOutlined from '@mui/icons-material/GroupsOutlined'
import HomeOutlined from '@mui/icons-material/HomeOutlined'
import { EMPLOYEE_LIST_ROLES } from './auth/roles'

export const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: HomeOutlined, end: true },
  { to: '/projects', label: 'Projects', icon: FolderOutlined },
  { to: '/teams', label: 'Teams', icon: GroupsOutlined },
  { to: '/reports', label: 'Reports', icon: AssessmentOutlined },
  { to: '/employees', label: 'Employees', icon: BadgeOutlined, visible: (role) => EMPLOYEE_LIST_ROLES.includes(role) },
]

/** The links this role can use. */
export const navItemsFor = (role) => NAV_ITEMS.filter((item) => !item.visible || item.visible(role))

/** The nav label for a path ("/projects/p-1" -> "Projects"), for the top bar title. */
export function sectionTitle(pathname) {
  const match = NAV_ITEMS.filter((item) => (item.end ? pathname === item.to : pathname.startsWith(item.to)))
    .sort((a, b) => b.to.length - a.to.length)[0]
  return match?.label ?? ''
}
