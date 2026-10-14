// The project budget response (GET /api/projects/{id}/budget) as the fake server
// gives it to each viewer, pinned to docs/api-contract.md §7. Report 7 must agree.
import { describe, expect, it } from 'vitest'
import { seedData, signedInAs } from '../test/fakeApiServer'
import { getProjectBudget } from './budgetService'
import { budgetReport } from './reportService'

const withBudget = (projectId, amount) => {
  const db = seedData()
  db.projects.find((p) => p.id === projectId).planned_budget = amount
  return db
}

describe('project budget response', () => {
  it('admin view: totals, percent used, the flag and per-person lines', async () => {
    signedInAs('admin')
    const budget = await getProjectBudget('t', 'p-1')
    expect(Object.keys(budget)).toEqual(['project_id', 'planned_budget', 'committed_cost', 'used_cost_to_date',
      'percent_used', 'over_budget', 'hidden_reason', 'allocated_people', 'lines'])
    expect(budget).toMatchObject({
      project_id: 'p-1', planned_budget: 12000, committed_cost: 9977.73, used_cost_to_date: 3090.78,
      percent_used: 25.8, over_budget: false, hidden_reason: null, allocated_people: 3,
    })
    expect(budget.lines).toHaveLength(3)
  })

  it('manager view (3 or more people): the same totals, no lines', async () => {
    signedInAs('manager')
    const budget = await getProjectBudget('t', 'p-1')
    expect(budget).toEqual({
      project_id: 'p-1', planned_budget: 12000, committed_cost: 9977.73, used_cost_to_date: 3090.78,
      percent_used: 25.8, over_budget: false, hidden_reason: null, allocated_people: 3,
    })
  })

  it('hidden view (manager, below 3 people): costs, percent used and the flag are all null', async () => {
    signedInAs('u-6', { db: withBudget('p-2', 50000) })
    const budget = await getProjectBudget('t', 'p-2')
    expect(budget).toEqual({
      project_id: 'p-2', planned_budget: 50000, committed_cost: null, used_cost_to_date: null,
      percent_used: null, over_budget: null, hidden_reason: 'below_min_group', allocated_people: 2,
    })
  })

  it('a hidden group never gets percent used or the flag, whatever the budget', async () => {
    for (const amount of [null, 0, 1, 50000]) {
      signedInAs('u-6', { db: withBudget('p-2', amount) })
      const budget = await getProjectBudget('t', 'p-2')
      expect(budget.percent_used).toBeNull()
      expect(budget.over_budget).toBeNull()
    }
  })

  it('no planned budget: percent used and the flag are null', async () => {
    signedInAs('admin')
    const budget = await getProjectBudget('t', 'p-2')
    expect(budget).toMatchObject({ planned_budget: null, percent_used: null, over_budget: null })
  })

  it('a planned budget of 0: percent used is null, any committed cost is over budget', async () => {
    signedInAs('admin', { db: withBudget('p-1', 0) })
    const budget = await getProjectBudget('t', 'p-1')
    expect(budget).toMatchObject({ planned_budget: 0, percent_used: null, over_budget: true })
  })

  it('percent used has one decimal; over budget compares committed cost', async () => {
    signedInAs('admin', { db: withBudget('p-1', 9977.73) })
    expect(await getProjectBudget('t', 'p-1')).toMatchObject({ percent_used: 31, over_budget: false })
    signedInAs('admin', { db: withBudget('p-1', 9977.72) })
    expect(await getProjectBudget('t', 'p-1')).toMatchObject({ percent_used: 31, over_budget: true })
  })

  it.each([['admin', 'p-1'], ['manager', 'p-1'], ['u-6', 'p-2']])(
    'report 7 gives %s the same values as the budget endpoint', async (who, projectId) => {
      signedInAs(who, { db: withBudget('p-2', 50000) })
      const budget = await getProjectBudget('t', projectId)
      const row = (await budgetReport('t')).projects.find((p) => p.id === projectId)
      for (const key of ['planned_budget', 'committed_cost', 'used_cost_to_date', 'percent_used', 'over_budget',
        'hidden_reason']) {
        expect(row[key]).toEqual(budget[key])
      }
    },
  )
})
