// Extra routes for the fake API server (fakeApiServer.js), one file per topic.
//
// fakeApiServer.js serves every endpoint in docs/api-contract.md that the app
// used when it was written. When a new page needs a new endpoint (after the
// contract has it), add the fake here instead of growing fakeApiServer.js:
//
//   1. Create test/fakeHandlers/<topic>.js exporting an array of routes in the
//      same shape as fakeApiServer.js:  [method, pathPattern, handler]
//
//        import { reply } from '../fakeAuthServer'
//        export const timesheetRoutes = [
//          ['GET', /^\/api\/timesheets\/$/, ({ query, db, me, today }) =>
//            reply(200, { timesheets: db.timesheets ?? [] })],
//        ]
//
//      The handler gets { body, query, params } like the core routes, plus
//      db (the in-memory data), me() (the signed-in employee) and today.
//   2. List it below:  ...timesheetRoutes,
//
// Core routes are matched first, so a plug-in cannot change an existing
// endpoint; to make one fail in a single test, use signedInAs(role, { routes }).

import { crudRoutes } from './crud'

export const extraRoutes = [
  ...crudRoutes,
]
