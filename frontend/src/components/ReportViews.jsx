// One component per report in docs/api-contract.md §8. Each loads its own data
// and shows loading, empty and error states. Money follows the hiding rule.
// Filters live in the address (?status=, ?team=, ?reason=, ?overdue=1, ?over=1;
// hooks/useUrlFilter.js), so Home's cards open a report already filtered. Switching
// tabs starts with none (ReportsPage keeps only ?report=). Search text stays local.
import { useCallback, useState } from 'react'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { Link as RouterLink } from 'react-router-dom'
import { useLoad } from '../auth/useApi'
import * as projectService from '../services/projectService'
import * as reportService from '../services/reportService'
import * as teamService from '../services/teamService'
import {
  DELIVERABLE_STATUS, PROJECT_STATUS, RISK_REASONS, formatDate, formatMoney, formatPercent, formatWeek,
  formatWeekShort, hiddenMessage,
} from '../pages/format'
import { useBreakpoint } from '../hooks/useBreakpoint'
import { toneSx } from '../theme'
import BudgetBar from './BudgetBar'
import BudgetFlag from './BudgetFlag'
import CapacityHeatmap, { HeatLegend } from './heatmap/CapacityHeatmap'
import { shiftWeek } from './heatmap/heatScale'
import { Empty, LoadState } from './PageState'
import { FilterBar, SearchField, SelectFilter, SwitchFilter } from './filters/Filters'
import { chosen, emptyText, matches, optionsFrom, optionsOf, searchTerm } from './filters/filterMath'
import { anyValue, useUrlFilter, useUrlFlag } from '../hooks/useUrlFilter'
import Paginated from './Paginated'
import ResponsiveTable from './ResponsiveTable'
import StatusChip from './StatusChip'
import { PersonName } from './viz/Avatar'
import HoursMeter from './viz/HoursMeter'
import { ProjectName } from './viz/ProjectTile'
import StatusBar from './viz/StatusBar'

const projectLink = (p) => <Link component={RouterLink} to={`/projects/${encodeURIComponent(p.id)}`}>{p.name}</Link>
const money = (amount) => (amount === null || amount === undefined ? '—' : formatMoney(amount))
const DEFAULT_THRESHOLD = 32
const PICK_PROJECT = 'Choose a project to see its dependency chain.'
const RESOURCE_WEEKS = 12 // the server's default window (§8)
/** The Team filter's choice for people on no team. */
const NO_TEAM = 'none'
/** Team filter options from report rows that carry a `team`. */
const teamsIn = (rows) => optionsFrom(rows ?? [], (r) => r.team && { value: r.team.id, label: r.team.name })

/** 1. Project status: progress and deliverable counts per project. */
export function ProjectStatusReport() {
  const load = useCallback((call) => call((token) => reportService.projectStatus(token)), [])
  const result = useLoad(load)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useUrlFilter('status', Object.keys(PROJECT_STATUS))
  const [teamParam, setTeamId] = useUrlFilter('team', anyValue)
  const teamOptions = teamsIn(result.data?.projects)
  const teamId = chosen(teamParam, teamOptions)
  return (
    <>
      <FilterBar label="Filter project status" columns="2fr 1fr 1fr">
        <SearchField label="Search projects" value={search} onChange={setSearch} />
        <SelectFilter label="Status" allLabel="All statuses" value={status} onChange={setStatus}
          options={optionsOf(PROJECT_STATUS)} />
        <SelectFilter label="Team" allLabel="All teams" value={teamId} onChange={setTeamId} options={teamOptions} />
      </FilterBar>
    <LoadState result={result} label="Loading project status" skeleton="table">
      {(data) => {
        const term = searchTerm(search)
        const rows = data.projects.filter((p) => matches(term, p.name, p.team?.name)
          && (!status || p.status === status) && (!teamId || p.team?.id === teamId))
        return (
        <ResponsiveTable label="Project status" rows={rows}
          empty={emptyText('projects', { term, filtered: Boolean(status || teamId), none: 'No projects to report on.' })}
          columns={[
            { key: 'name', label: 'Project', primary: true, render: (p) => <ProjectName name={p.name}>{projectLink(p)}</ProjectName> },
            { key: 'team', label: 'Team', render: (p) => p.team?.name },
            { key: 'status', label: 'Status', render: (p) => <StatusChip status={p.status} /> },
            { key: 'progress', label: 'Complete', render: (p) => {
              const d = p.deliverables
              return (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 140 }}>
                  <Box role="img" sx={{ flexGrow: 1 }} aria-label={`${p.name}: ${d.done} done, `
                    + `${d.in_progress} in progress, ${d.not_started} not started`}>
                    <StatusBar legend={false} height={8} segments={[
                      { key: 'done', label: 'Done', count: d.done, tone: 'done' },
                      { key: 'in_progress', label: 'In progress', count: d.in_progress, tone: 'in_progress' },
                      { key: 'not_started', label: 'Not started', count: d.not_started, tone: 'not_started' },
                    ]} />
                  </Box>
                  <span>{Math.round(p.percent_complete)}%</span>
                </Box>
              )
            } },
            { key: 'done', label: 'Done', align: 'right', render: (p) => `${p.deliverables.done} of ${p.deliverables.total}` },
            { key: 'overdue', label: 'Overdue', align: 'right', render: (p) => p.deliverables.overdue },
            { key: 'blocked', label: 'Blocked', align: 'right', render: (p) => p.deliverables.blocked },
          ]} />
        )
      }}
    </LoadState>
    </>
  )
}

/** Cards per page for report card lists. */
const CARD_PAGE_SIZES = [10, 25, 50]

/** 2. At-risk projects with the reasons, as cards. */
export function AtRiskReport() {
  const load = useCallback((call) => call((token) => reportService.atRiskProjects(token)), [])
  const result = useLoad(load)
  const [search, setSearch] = useState('')
  const [reason, setReason] = useUrlFilter('reason', Object.keys(RISK_REASONS))
  const [teamParam, setTeamId] = useUrlFilter('team', anyValue)
  const teamOptions = teamsIn(result.data?.projects)
  const teamId = chosen(teamParam, teamOptions)
  const filter = (projects) => {
    const term = searchTerm(search)
    const rows = projects.filter((p) => matches(term, p.name, p.team?.name, p.manager?.name)
      && (!reason || p.reasons.includes(reason)) && (!teamId || p.team?.id === teamId))
    const none = 'No projects are at risk right now.'
    return { rows, empty: emptyText('at-risk projects', { term, filtered: Boolean(reason || teamId), none }) }
  }
  return (
    <>
      <FilterBar label="Filter at-risk projects" columns="2fr 1fr 1fr">
        <SearchField label="Search at-risk projects" value={search} onChange={setSearch} />
        <SelectFilter label="Reason" allLabel="All reasons" value={reason} onChange={setReason}
          options={optionsOf(RISK_REASONS)} />
        <SelectFilter label="Team" allLabel="All teams" value={teamId} onChange={setTeamId} options={teamOptions} />
      </FilterBar>
    <LoadState result={result} label="Loading at-risk projects" skeleton="cards">
      {(data) => {
        const { rows, empty } = filter(data.projects)
        return (rows.length === 0 ? <Empty>{empty}</Empty> : (
        <Paginated rows={rows} label="At-risk projects" pageSize={10} pageSizes={CARD_PAGE_SIZES}>
        {(projects) => (
        <Stack component="ul" aria-label="At-risk projects" spacing={1.5} sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {projects.map((p) => (
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
        )}
        </Paginated>
        ))
      }}
    </LoadState>
    </>
  )
}

/** 3. Resource allocation: hours per person per week (other teams' projects are not named). */
export function ResourcesReport() {
  const { isPhone } = useBreakpoint()
  const [from, setFrom] = useState(null) // null: the server's default window (this week + 11)
  const load = useCallback(
    (call) => call((token) => reportService.resourceAllocation(token, { from: from ?? undefined })),
    [from],
  )
  const result = useLoad(load)
  const loadTeams = useCallback((call) => call((token) => teamService.listTeams(token)), [])
  const teams = useLoad(loadTeams)
  const [search, setSearch] = useState('')
  const [teamParam, setTeamId] = useUrlFilter('team', anyValue) // a team id, NO_TEAM, or '' for everyone
  const teamOptions = [{ value: NO_TEAM, label: 'No team' },
    ...optionsFrom(teams.data ?? [], (t) => ({ value: t.id, label: t.name }))]
  const teamId = chosen(teamParam, teamOptions)
  const first = result.data?.weeks?.[0]
  const span = result.data?.weeks?.length || RESOURCE_WEEKS
  return (
    <>
      <FilterBar label="Filter people" columns="2fr 1fr">
        <SearchField label="Search people" value={search} onChange={setSearch} />
        <SelectFilter label="Team" allLabel="All teams" value={teamId} onChange={setTeamId} options={teamOptions} />
      </FilterBar>
      <Box component="nav" aria-label="Weeks shown" sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mb: 1 }}>
        <Button size="small" variant="outlined" sx={{ minHeight: 44 }} disabled={!first}
          onClick={() => setFrom(shiftWeek(first, -span))}>
          Previous {span} weeks
        </Button>
        <Button size="small" variant="outlined" sx={{ minHeight: 44 }} disabled={!first}
          onClick={() => setFrom(shiftWeek(first, span))}>
          Next {span} weeks
        </Button>
        {from && <Button size="small" sx={{ minHeight: 44 }} onClick={() => setFrom(null)}>This week</Button>}
      </Box>
      <LoadState result={result} label="Loading resource allocation" skeleton="table">
        {(data) => {
          const term = searchTerm(search)
          const people = data.people.filter((p) => matches(term, p.name)
            && (!teamId || (teamId === NO_TEAM ? !p.team_id : p.team_id === teamId)))
          return (people.length === 0
            ? <Empty>{emptyText('people', { term, filtered: Boolean(teamId), none: 'No one to show.' })}</Empty> : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Hours per week, from the {formatWeek(first)}. “Other projects” is time on projects you can’t see.
            </Typography>
            <Paginated rows={people} label="People">
              {(people) => <CapacityHeatmap weeks={data.weeks} people={people} isPhone={isPhone} />}
            </Paginated>
            <HeatLegend />
          </>
          ))
        }}
      </LoadState>
    </>
  )
}

/** 4. Deliverable status, ordered by due date, optionally only the overdue ones. */
export function DeliverablesReport() {
  const [overdueOnly, setOverdueOnly] = useUrlFlag('overdue')
  const load = useCallback(
    (call) => call((token) => reportService.deliverableStatus(token, { overdue: overdueOnly || undefined })),
    [overdueOnly],
  )
  const result = useLoad(load)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useUrlFilter('status', Object.keys(DELIVERABLE_STATUS))
  return (
    <>
      <FilterBar label="Filter deliverables" columns="2fr 1fr auto">
        <SearchField label="Search deliverables" value={search} onChange={setSearch} />
        <SelectFilter label="Status" allLabel="All statuses" value={status} onChange={setStatus}
          options={optionsOf(DELIVERABLE_STATUS)} />
        <SwitchFilter label="Only overdue" checked={overdueOnly} onChange={setOverdueOnly} />
      </FilterBar>
      <LoadState result={result} label="Loading deliverable status" skeleton="table">
        {(data) => {
          const term = searchTerm(search)
          const rows = data.deliverables.filter((d) => matches(term, d.name, d.project?.name)
            && (!status || d.status === status))
          const none = overdueOnly ? 'Nothing is overdue.' : 'No deliverables to report on.'
          return (
          <ResponsiveTable label="Deliverable status" rows={rows}
            empty={emptyText('deliverables', { term, filtered: Boolean(status), none })}
            columns={[
              { key: 'name', label: 'Deliverable', primary: true, render: (d) => d.name },
              { key: 'project', label: 'Project', render: (d) => projectLink(d.project) },
              { key: 'status', label: 'Status', render: (d) => <StatusChip status={d.status} /> },
              { key: 'due', label: 'Due', render: (d) => formatDate(d.due_date) },
              { key: 'flags', label: 'Flags', render: (d) => (
                <Box component="span" sx={{ display: 'inline-flex', gap: 0.5, flexWrap: 'wrap' }}>
                  {d.overdue && <Chip size="small" label="Overdue" sx={toneSx('overdue')} />}
                  {d.blocked && <Chip size="small" label="Blocked" sx={toneSx('blocked')} />}
                  {!d.overdue && !d.blocked && '—'}
                </Box>
              ) },
              { key: 'blocking', label: 'Holds up', align: 'right', render: (d) => (
                d.blocking.length ? `${d.blocking.length} ${d.blocking.length === 1 ? 'deliverable' : 'deliverables'}` : '—'
              ) },
            ]} />
          )
        }}
      </LoadState>
    </>
  )
}

/** 5. Near capacity: people above a threshold (default 32 h) in any week. */
export function CapacityReport() {
  const [input, setInput] = useState(String(DEFAULT_THRESHOLD))
  const valid = /^\d+$/.test(input.trim()) && Number(input) >= 1 && Number(input) <= 40
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD)
  const [search, setSearch] = useState('')
  const load = useCallback((call) => call((token) => reportService.overAllocated(token, { threshold })), [threshold])
  const result = useLoad(load)

  function handleChange(event) {
    const text = event.target.value
    setInput(text)
    if (/^\d+$/.test(text.trim()) && Number(text) >= 1 && Number(text) <= 40) setThreshold(Number(text))
  }

  return (
    <>
      <FilterBar label="Filter near capacity" columns="2fr 1fr" align="start">
        <SearchField label="Search people" value={search} onChange={setSearch} />
        <TextField label="Threshold (hours per week)" value={input} onChange={handleChange} size="small"
          error={!valid}
          helperText={valid ? 'People above this in any week are listed. 40 should list no one.'
            : 'Enter whole hours from 1 to 40.'}
          slotProps={{ htmlInput: { inputMode: 'numeric' } }} />
      </FilterBar>
      <LoadState result={result} label="Loading near-capacity report" skeleton="table">
        {(data) => {
          const term = searchTerm(search)
          return (
          <ResponsiveTable label="Near capacity" rows={data.people.filter((p) => matches(term, p.name))}
            empty={emptyText('people', { term, none: `No one is above ${data.threshold} hours in any week.` })}
            columns={[
              { key: 'name', label: 'Person', primary: true, render: (p) => <PersonName name={p.name} /> },
              { key: 'weeks', label: `Weeks above ${data.threshold} h`, render: (p) => (
                <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0, display: 'grid', gap: 0.5 }}>
                  {p.weeks.map((w) => (
                    <Box component="li" key={w.week_start} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Box component="span" sx={{ minWidth: 110 }}>{formatWeekShort(w.week_start)}: {w.total_hours} h</Box>
                      <HoursMeter hours={w.total_hours} width={140} decorative />
                    </Box>
                  ))}
                </Box>
              ) },
            ]} />
          )
        }}
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
    <LoadState result={projects} label="Loading projects" skeleton="list">
      {(list) => (list.length === 0 ? <Empty>No projects to show.</Empty> : (
        <>
          <Autocomplete options={list} value={list.find((p) => p.id === projectId) ?? null} size="small"
            onChange={(_, p) => setProjectId(p?.id ?? '')} sx={{ mb: 2, maxWidth: 420 }}
            getOptionLabel={(p) => p.name} getOptionKey={(p) => p.id} isOptionEqualToValue={(a, b) => a.id === b.id}
            noOptionsText="No projects match."
            renderInput={(params) => <TextField {...params} label="Project" />} />
          {!projectId ? <Empty>{PICK_PROJECT}</Empty> : (
            <LoadState result={chain} label="Loading dependency chain" skeleton="table">
              {(data) => {
                if (!data) return <Empty>{PICK_PROJECT}</Empty>
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
  const [search, setSearch] = useState('')
  const [teamParam, setTeamId] = useUrlFilter('team', anyValue)
  const [overOnly, setOverOnly] = useUrlFlag('over')
  const teamOptions = optionsFrom(result.data?.teams ?? [], (t) => ({ value: t.id, label: t.name }))
  const teamId = chosen(teamParam, teamOptions)
  const note = (row) => (row.hidden_reason ? hiddenMessage(row.hidden_reason) : '')
  return (
    <>
      <FilterBar label="Filter budgets" columns="2fr 1fr auto">
        <SearchField label="Search budgets" value={search} onChange={setSearch} />
        <SelectFilter label="Team" allLabel="All teams" value={teamId} onChange={setTeamId} options={teamOptions} />
        <SwitchFilter label="Only over budget" checked={overOnly} onChange={setOverOnly} />
      </FilterBar>
    <LoadState result={result} label="Loading budget report" skeleton="table">
      {(data) => {
        const term = searchTerm(search)
        const projects = data.projects.filter((p) => matches(term, p.name, p.team?.name)
          && (!teamId || p.team?.id === teamId) && (!overOnly || p.over_budget === true))
        const teams = data.teams.filter((t) => matches(term, t.name) && (!teamId || t.id === teamId))
        return (
        <Stack spacing={3}>
          <Box component="section" aria-labelledby="budget-projects-heading">
            <Typography id="budget-projects-heading" variant="h6" component="h2" gutterBottom>Projects</Typography>
            <ResponsiveTable label="Project budgets" rows={projects}
              empty={emptyText('projects', { term, filtered: Boolean(teamId || overOnly), none: 'No projects to report on.' })}
              columns={[
                { key: 'name', label: 'Project', primary: true, render: projectLink },
                { key: 'team', label: 'Team', render: (p) => p.team?.name },
                { key: 'budget', label: 'Planned budget', align: 'right',
                  render: (p) => (p.planned_budget === null ? 'Not set' : money(p.planned_budget)) },
                { key: 'committed', label: 'Committed', align: 'right', render: (p) => money(p.committed_cost) },
                { key: 'used', label: 'Used to date', align: 'right', render: (p) => money(p.used_cost_to_date) },
                { key: 'percent', label: 'Used %', align: 'right', render: (p) => formatPercent(p.percent_used) },
                { key: 'flag', label: 'Budget', render: (p) => (p.hidden_reason ? '—' : (
                  <Box sx={{ minWidth: 140 }}><BudgetBar budget={p} index={0} words={false} /></Box>
                )) },
                { key: 'note', label: 'Note', render: note },
              ]} />
          </Box>
          <Box component="section" aria-labelledby="budget-teams-heading">
            <Typography id="budget-teams-heading" variant="h6" component="h2" gutterBottom>Teams</Typography>
            <ResponsiveTable label="Team budgets" rows={teams}
              empty={emptyText('teams', { term, filtered: Boolean(teamId), none: 'No teams to report on.' })}
              columns={[
                { key: 'name', label: 'Team', primary: true, render: (t) => t.name },
                { key: 'weekly', label: 'Weekly', align: 'right', render: (t) => money(t.weekly) },
                { key: 'yearly', label: 'Yearly', align: 'right', render: (t) => money(t.yearly) },
                { key: 'note', label: 'Note', render: note },
              ]} />
          </Box>
        </Stack>
        )
      }}
    </LoadState>
    </>
  )
}
