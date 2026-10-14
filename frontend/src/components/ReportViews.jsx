// One component per report in docs/api-contract.md §8. Each loads its own data
// and shows loading, empty and error states. Money follows the hiding rule.
import { useCallback, useState } from 'react'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import FormControlLabel from '@mui/material/FormControlLabel'
import LinearProgress from '@mui/material/LinearProgress'
import Link from '@mui/material/Link'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { Link as RouterLink } from 'react-router-dom'
import { useLoad } from '../auth/useApi'
import * as projectService from '../services/projectService'
import * as reportService from '../services/reportService'
import { RISK_REASONS, formatDate, formatMoney, formatPercent, hiddenMessage } from '../pages/format'
import BudgetFlag from './BudgetFlag'
import { Empty, LoadState } from './PageState'
import ResponsiveTable from './ResponsiveTable'
import StatusChip from './StatusChip'

const projectLink = (p) => <Link component={RouterLink} to={`/projects/${encodeURIComponent(p.id)}`}>{p.name}</Link>
const shortWeek = (week) => formatDate(week).replace(/, \d{4}$/, '')
const money = (amount) => (amount === null || amount === undefined ? '—' : formatMoney(amount))
const DEFAULT_THRESHOLD = 32

/** 1. Project status: progress and deliverable counts per project. */
export function ProjectStatusReport() {
  const load = useCallback((call) => call((token) => reportService.projectStatus(token)), [])
  const result = useLoad(load)
  return (
    <LoadState result={result} label="Loading project status">
      {(data) => (
        <ResponsiveTable label="Project status" rows={data.projects} empty="No projects to report on."
          columns={[
            { key: 'name', label: 'Project', primary: true, render: projectLink },
            { key: 'team', label: 'Team', render: (p) => p.team?.name },
            { key: 'status', label: 'Status', render: (p) => <StatusChip status={p.status} /> },
            { key: 'progress', label: 'Complete', render: (p) => (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 120 }}>
                <LinearProgress variant="determinate" value={p.percent_complete} sx={{ flexGrow: 1 }}
                  aria-label={`${p.name} complete`} />
                <span>{Math.round(p.percent_complete)}%</span>
              </Box>
            ) },
            { key: 'done', label: 'Done', align: 'right', render: (p) => `${p.deliverables.done} of ${p.deliverables.total}` },
            { key: 'overdue', label: 'Overdue', align: 'right', render: (p) => p.deliverables.overdue },
            { key: 'blocked', label: 'Blocked', align: 'right', render: (p) => p.deliverables.blocked },
          ]} />
      )}
    </LoadState>
  )
}

/** 2. At-risk projects with the reasons, as cards. */
export function AtRiskReport() {
  const load = useCallback((call) => call((token) => reportService.atRiskProjects(token)), [])
  const result = useLoad(load)
  return (
    <LoadState result={result} label="Loading at-risk projects">
      {(data) => (data.projects.length === 0 ? <Empty>No projects are at risk right now.</Empty> : (
        <Stack component="ul" aria-label="At-risk projects" spacing={1.5} sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {data.projects.map((p) => (
            <Paper component="li" key={p.id} variant="outlined" sx={{ p: 2 }}>
              <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 600 }}>{projectLink(p)}</Typography>
              <Typography variant="body2" color="text.secondary">
                {p.team?.name} · Manager: {p.manager?.name ?? 'none'}
              </Typography>
              <Box component="ul" aria-label={`Why ${p.name} is at risk`}
                sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, listStyle: 'none', p: 0, m: 0, mt: 1 }}>
                {p.reasons.map((reason) => (
                  <li key={reason}><Chip size="small" color="warning" label={RISK_REASONS[reason] ?? 'Other risk'} /></li>
                ))}
              </Box>
            </Paper>
          ))}
        </Stack>
      ))}
    </LoadState>
  )
}

/** 3. Resource allocation: hours per person per week (other teams' projects are not named). */
export function ResourcesReport() {
  const load = useCallback((call) => call((token) => reportService.resourceAllocation(token)), [])
  const result = useLoad(load)
  return (
    <LoadState result={result} label="Loading resource allocation">
      {(data) => (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Hours per week, from the week of {formatDate(data.weeks[0])}. “Elsewhere” is time on projects you can’t see.
          </Typography>
          <ResponsiveTable label="Resource allocation" rows={data.people} empty="No one to show."
            columns={[
              { key: 'name', label: 'Person', primary: true, render: (p) => p.name },
              ...data.weeks.map((week, i) => ({
                key: week, label: shortWeek(week), align: 'right', render: (p) => {
                  const w = p.weeks[i]
                  if (!w || w.total_hours === 0) return '—'
                  const names = w.projects.map((x) => `${x.name}: ${x.hours} h`)
                  if (w.other_hours) names.push(`Elsewhere: ${w.other_hours} h`)
                  return <span title={names.join(', ')}>{w.total_hours} h</span>
                },
              })),
            ]} />
        </>
      )}
    </LoadState>
  )
}

/** 4. Deliverable status, ordered by due date, optionally only the overdue ones. */
export function DeliverablesReport() {
  const [overdueOnly, setOverdueOnly] = useState(false)
  const load = useCallback(
    (call) => call((token) => reportService.deliverableStatus(token, { overdue: overdueOnly || undefined })),
    [overdueOnly],
  )
  const result = useLoad(load)
  return (
    <>
      <FormControlLabel label="Only overdue" sx={{ mb: 1 }} control={
        <Switch checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
      } />
      <LoadState result={result} label="Loading deliverable status">
        {(data) => (
          <ResponsiveTable label="Deliverable status" rows={data.deliverables}
            empty={overdueOnly ? 'Nothing is overdue.' : 'No deliverables to report on.'}
            columns={[
              { key: 'name', label: 'Deliverable', primary: true, render: (d) => d.name },
              { key: 'project', label: 'Project', render: (d) => projectLink(d.project) },
              { key: 'status', label: 'Status', render: (d) => <StatusChip status={d.status} /> },
              { key: 'due', label: 'Due', render: (d) => formatDate(d.due_date) },
              { key: 'flags', label: 'Flags', render: (d) => (
                <Box component="span" sx={{ display: 'inline-flex', gap: 0.5, flexWrap: 'wrap' }}>
                  {d.overdue && <Chip size="small" color="error" label="Overdue" />}
                  {d.blocked && <Chip size="small" color="warning" label="Blocked" />}
                  {!d.overdue && !d.blocked && '—'}
                </Box>
              ) },
              { key: 'blocking', label: 'Holds up', align: 'right', render: (d) => (
                d.blocking.length ? `${d.blocking.length} ${d.blocking.length === 1 ? 'deliverable' : 'deliverables'}` : '—'
              ) },
            ]} />
        )}
      </LoadState>
    </>
  )
}

/** 5. Near capacity: people above a threshold (default 32 h) in any week. */
export function CapacityReport() {
  const [input, setInput] = useState(String(DEFAULT_THRESHOLD))
  const valid = /^\d+$/.test(input.trim()) && Number(input) >= 1 && Number(input) <= 40
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD)
  const load = useCallback((call) => call((token) => reportService.overAllocated(token, { threshold })), [threshold])
  const result = useLoad(load)

  function handleChange(event) {
    const text = event.target.value
    setInput(text)
    if (/^\d+$/.test(text.trim()) && Number(text) >= 1 && Number(text) <= 40) setThreshold(Number(text))
  }

  return (
    <>
      <TextField label="Threshold (hours per week)" value={input} onChange={handleChange} size="small"
        error={!valid} sx={{ mb: 2, maxWidth: 280 }}
        helperText={valid ? 'People above this in any week are listed. 40 should list no one.'
          : 'Enter whole hours from 1 to 40.'}
        slotProps={{ htmlInput: { inputMode: 'numeric' } }} />
      <LoadState result={result} label="Loading near-capacity report">
        {(data) => (
          <ResponsiveTable label="Near capacity" rows={data.people}
            empty={`No one is above ${data.threshold} hours in any week.`}
            columns={[
              { key: 'name', label: 'Person', primary: true, render: (p) => p.name },
              { key: 'weeks', label: `Weeks above ${data.threshold} h`, render: (p) => (
                p.weeks.map((w) => `${shortWeek(w.week_start)}: ${w.total_hours} h`).join(', ')
              ) },
            ]} />
        )}
      </LoadState>
    </>
  )
}

/** 6. Dependency chain of one project: the order to work in and the longest chain. */
export function ChainReport() {
  const [projectId, setProjectId] = useState('')
  const loadProjects = useCallback((call) => call((token) => projectService.listProjects(token)), [])
  const projects = useLoad(loadProjects)
  const loadChain = useCallback(
    (call) => (projectId ? call((token) => reportService.dependencyChain(token, { projectId })) : Promise.resolve(null)),
    [projectId],
  )
  const chain = useLoad(loadChain)

  return (
    <LoadState result={projects} label="Loading projects">
      {(list) => (list.length === 0 ? <Empty>No projects to show.</Empty> : (
        <>
          <TextField select label="Project" size="small" value={projectId} sx={{ mb: 2, minWidth: 240 }}
            onChange={(e) => setProjectId(e.target.value)}>
            {list.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
          </TextField>
          {!projectId ? <Empty>Choose a project to see its dependency chain.</Empty> : (
            <LoadState result={chain} label="Loading dependency chain">
              {(data) => {
                if (!data) return null
                const byId = new Map(data.nodes.map((n) => [n.id, n]))
                const depsOf = (id) => data.edges.filter((e) => e.to === id).map((e) => byId.get(e.from)?.name)
                if (data.nodes.length === 0) return <Empty>This project has no deliverables yet.</Empty>
                return (
                  <>
                    <Typography sx={{ mb: 1 }}>
                      <strong>Longest chain:</strong> {data.longest_chain.map((id) => byId.get(id)?.name).join(' → ')}
                    </Typography>
                    <ResponsiveTable label="Dependency chain" rows={data.order.map((id) => byId.get(id))}
                      empty="No deliverables." columns={[
                        { key: 'name', label: 'Deliverable', primary: true, render: (n) => (
                          <Box component="span" sx={{ pl: n.depth * 2 }}>{n.name}</Box>
                        ) },
                        { key: 'step', label: 'Step', align: 'right', render: (n) => n.depth + 1 },
                        { key: 'status', label: 'Status', render: (n) => <StatusChip status={n.status} /> },
                        { key: 'due', label: 'Due', render: (n) => formatDate(n.due_date) },
                        { key: 'after', label: 'After', render: (n) => depsOf(n.id).join(', ') || '—' },
                      ]} />
                  </>
                )
              }}
            </LoadState>
          )}
        </>
      ))}
    </LoadState>
  )
}

/**
 * 7. Budget used vs planned: per project the planned budget, committed cost,
 * used to date, percent used and over-budget flag; per team the salary totals.
 * Hidden totals say why.
 */
export function BudgetReport() {
  const load = useCallback((call) => call((token) => reportService.budgetReport(token)), [])
  const result = useLoad(load)
  const note = (row) => (row.hidden_reason ? hiddenMessage(row.hidden_reason) : '')
  return (
    <LoadState result={result} label="Loading budget report">
      {(data) => (
        <Stack spacing={3}>
          <Box component="section" aria-labelledby="budget-projects-heading">
            <Typography id="budget-projects-heading" variant="h6" component="h2" gutterBottom>Projects</Typography>
            <ResponsiveTable label="Project budgets" rows={data.projects} empty="No projects to report on."
              columns={[
                { key: 'name', label: 'Project', primary: true, render: projectLink },
                { key: 'team', label: 'Team', render: (p) => p.team?.name },
                { key: 'budget', label: 'Planned budget', align: 'right',
                  render: (p) => (p.planned_budget === null ? 'Not set' : money(p.planned_budget)) },
                { key: 'committed', label: 'Committed', align: 'right', render: (p) => money(p.committed_cost) },
                { key: 'used', label: 'Used to date', align: 'right', render: (p) => money(p.used_cost_to_date) },
                { key: 'percent', label: 'Used %', align: 'right', render: (p) => formatPercent(p.percent_used) },
                { key: 'flag', label: 'Budget', render: (p) => (p.hidden_reason ? '—' : (
                  <BudgetFlag plannedBudget={p.planned_budget} overBudget={p.over_budget} />
                )) },
                { key: 'note', label: 'Note', render: note },
              ]} />
          </Box>
          <Box component="section" aria-labelledby="budget-teams-heading">
            <Typography id="budget-teams-heading" variant="h6" component="h2" gutterBottom>Teams</Typography>
            <ResponsiveTable label="Team budgets" rows={data.teams} empty="No teams to report on."
              columns={[
                { key: 'name', label: 'Team', primary: true, render: (t) => t.name },
                { key: 'weekly', label: 'Weekly', align: 'right', render: (t) => money(t.weekly) },
                { key: 'yearly', label: 'Yearly', align: 'right', render: (t) => money(t.yearly) },
                { key: 'note', label: 'Note', render: note },
              ]} />
          </Box>
        </Stack>
      )}
    </LoadState>
  )
}
