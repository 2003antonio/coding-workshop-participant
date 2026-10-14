-- Teams, each with one lead, and the team each employee belongs to (at most one).
-- Plain DDL only: runner.py splits this file on ';' (see 001_init.sql).

-- 1) teams. lead_id is a manager or admin, checked by the teams service. The
-- lead is never a member of a team they lead (employees.team_id <> teams.id).
CREATE TABLE IF NOT EXISTS teams (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (btrim(name) <> ''),
    lead_id uuid NOT NULL REFERENCES employees (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz
);

-- Case-insensitive unique name among active teams only, so an archived
-- team's name can be reused.
CREATE UNIQUE INDEX IF NOT EXISTS uq_teams_name_lower_active
    ON teams (lower(name)) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_teams_lead ON teams (lead_id);

-- 2) employees.team_id: NULL means "on no team".
ALTER TABLE employees ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams (id);
CREATE INDEX IF NOT EXISTS ix_employees_team ON employees (team_id);
