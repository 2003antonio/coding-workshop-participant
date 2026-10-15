import { createContext, useContext } from 'react'

/**
 * One refresh for everything on a project page (ProjectDetailPage owns it):
 * after an assignment, deliverable or project change, refresh() bumps
 * refreshKey and every load that passes it to useLoad fetches again, keeping
 * its last numbers on screen meanwhile. Outside a project page it does nothing.
 *   const { refreshKey, refresh } = useProjectRefresh()
 *   const budget = useLoad(load, refreshKey)
 */
export const ProjectRefreshContext = createContext({ refreshKey: 0, refresh: () => {} })

export const useProjectRefresh = () => useContext(ProjectRefreshContext)
