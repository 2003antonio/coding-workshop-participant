// The admin (company) and manager (team) dashboard on Home. Every report has
// its own useLoad, so one failing report only shows an error in its own cards.
// The server already limits each report to what the caller may see (§8).
import { useCallback } from 'react'
import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import { Link as RouterLink } from 'react-router-dom'
import { useLoad } from '../../auth/useApi'
import * as reportService from '../../services/reportService'
import AtRiskList from './AtRiskList'
import BudgetBars from './BudgetBars'
import DashboardSection from './DashboardSection'
import {
  activeCount, atRiskCount, DASHBOARD_LINKS, DASHBOARD_LIST_LIMIT, nearCapacityCount, overBudgetCount, overdueCount, portfolioHealth,
  topAtRisk, topBudgets,
} from './dashboardMath'
import StatCard from './StatCard'
import Paper from '@mui/material/Paper'
import Skeleton from '@mui/material/Skeleton'
import StatusBar from '../viz/StatusBar'
import ComingUp from '../ComingUp/ComingUp'
import { LoadState } from '../PageState'

/** "Coming up" on Home looks this many days ahead (plus everything overdue). */
const COMING_UP_DAYS = 14

/** Report 5's default: people above this many hours in a week are "near capacity". */
const NEAR_CAPACITY_HOURS = 32

/** Under a dashboard list cut to DASHBOARD_LIST_LIMIT rows: a link to the whole report. */
function ViewAll({ count, to, what }) {
  if (count <= DASHBOARD_LIST_LIMIT) return null
  return (
    <Link component={RouterLink} to={to} variant="body2" sx={{ display: 'inline-block', mt: 2, fontWeight: 600 }}>
      View all {count} {what}
    </Link>
  )
}

/** One bar: how many projects are healthy, at risk or over budget (each counted once). */
function PortfolioHealth({ status, risk, budget }) {
  const results = [status, risk, budget]
  let body
  if (results.some((r) => r.status === 'error')) {
    body = <Typography variant="body2" color="text.secondary">Portfolio health needs every report; see the cards below.</Typography>
  } else if (results.some((r) => r.status === 'loading')) {
    body = <Box role="status" aria-label="Loading portfolio health"><Skeleton variant="rounded" height={12} /></Box>
  } else {
    const h = portfolioHealth(status.data, risk.data, budget.data)
    const total = h.healthy + h.at_risk + h.over_budget
    body = (
      <>
        <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
          {total === 0 ? 'No projects yet.' : `${h.healthy} of ${total} ${total === 1 ? 'project' : 'projects'} healthy.`}
        </Typography>
        <StatusBar label="Projects by health" height={12} segments={[
          { key: 'healthy', label: 'Healthy', count: h.healthy, tone: 'done' },
          { key: 'at_risk', label: 'At risk', count: h.at_risk, tone: 'blocked', to: DASHBOARD_LINKS.atRisk },
          { key: 'over_budget', label: 'Over budget', count: h.over_budget, tone: 'overdue', to: DASHBOARD_LINKS.overBudget },
        ]} />
        {h.hidden > 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Budget hidden for {h.hidden} {h.hidden === 1 ? 'project' : 'projects'}: fewer than 3 people.
          </Typography>
        )}
      </>
    )
  }
  return (
    <Paper component="section" aria-labelledby="health-heading" variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Typography id="health-heading" variant="overline" component="h3" color="text.secondary"
        sx={{ display: 'block', lineHeight: 1.5, letterSpacing: '0.08em', mb: 0.5 }}>
        Portfolio health
      </Typography>
      {body}
    </Paper>
  )
}

export default function Dashboard({ role }) {
  const loadStatus = useCallback((call) => call((token) => reportService.projectStatus(token)), [])
  const status = useLoad(loadStatus)
  const loadRisk = useCallback((call) => call((token) => reportService.atRiskProjects(token)), [])
  const risk = useLoad(loadRisk)
  const loadBudget = useCallback((call) => call((token) => reportService.budgetReport(token)), [])
  const budget = useLoad(loadBudget)
  const loadCapacity = useCallback(
    (call) => call((token) => reportService.overAllocated(token, { threshold: NEAR_CAPACITY_HOURS })),
    [],
  )
  const capacity = useLoad(loadCapacity)
  const loadDeliverables = useCallback((call) => call((token) => reportService.deliverableStatus(token)), [])
  const deliverables = useLoad(loadDeliverables)

  return (
    <>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        {role === 'admin' ? 'Company overview: every team and project.' : 'Overview of the teams you lead.'}
      </Typography>

      <Box component="section" aria-labelledby="glance-heading" sx={{ mb: 3 }}>
        <Typography id="glance-heading" variant="h6" component="h2" gutterBottom>At a glance</Typography>
        <PortfolioHealth status={status} risk={risk} budget={budget} />
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          <StatCard id="stat-active" title="Active projects" result={status} count={activeCount}
            to={DASHBOARD_LINKS.active} />
          <StatCard id="stat-risk" title="At risk" result={risk} count={atRiskCount} to={DASHBOARD_LINKS.atRisk} />
          <StatCard id="stat-overdue" title="Overdue deliverables" result={status} count={overdueCount}
            to={DASHBOARD_LINKS.overdue} />
          <StatCard id="stat-budget" title="Over budget" result={budget} count={overBudgetCount}
            to={DASHBOARD_LINKS.overBudget} />
          <StatCard id="stat-capacity" title="Near capacity" result={capacity} count={nearCapacityCount}
            to={DASHBOARD_LINKS.nearCapacity} />
        </Box>
      </Box>

      <Box sx={{ mb: 3 }}>
        <LoadState result={deliverables} label="Loading coming up" skeleton="table">
          {(data) => (
            <ComingUp deliverables={data.deliverables} days={COMING_UP_DAYS} empty="Nothing due in the next 14 days."
              footer={<Link component={RouterLink} to="/reports?tab=deliverables">View all deliverables</Link>} />
          )}
        </LoadState>
      </Box>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, alignItems: 'start' }}>
        <DashboardSection id="risk-list" title="At-risk projects" result={risk} skeletonLines={4}>
          {(data) => (
            <>
              <AtRiskList projects={topAtRisk(data.projects)} />
              <ViewAll count={data.projects.length} to={DASHBOARD_LINKS.atRisk} what="at-risk projects" />
            </>
          )}
        </DashboardSection>
        <DashboardSection id="budget-bars" title="Budget used" result={budget} skeletonLines={4}>
          {(data) => (
            <>
              <BudgetBars projects={topBudgets(data.projects)} />
              <ViewAll count={data.projects.length} to="/reports?tab=budget" what="project budgets" />
            </>
          )}
        </DashboardSection>
      </Box>
    </>
  )
}
